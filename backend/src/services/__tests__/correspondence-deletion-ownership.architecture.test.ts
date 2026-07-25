import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const servicePath = path.resolve(
  process.cwd(),
  'src/services/letter/correspondence-deletion.ts',
);
const routePath = path.resolve(
  process.cwd(),
  'src/routes/admin/letters/content.ts',
);
const storageReferenceCleanupPath = path.resolve(
  process.cwd(),
  'src/services/storage-reference-cleanup.ts',
);

function exportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start === -1) {
    throw new Error(`Could not find exported function ${name}`);
  }
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('correspondence deletion ownership', () => {
  it('locks the complete group before checking its shared source fence', async () => {
    const source = await readFile(servicePath, 'utf8');
    const lock = source.indexOf('lockCorrespondenceGroupByLetterId(');
    const fence = source.indexOf('group.members.some(');
    const pageSnapshot = source.indexOf('const pages = await tx');
    const deletion = source.indexOf('.delete(letters)');

    expect(lock).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(lock);
    expect(pageSnapshot).toBeGreaterThan(fence);
    expect(deletion).toBeGreaterThan(pageSnapshot);
    expect(source.slice(fence, pageSnapshot)).toContain(
      'sourceRevisionChanged(',
    );
  });

  it('requires the caller source revision and delegates deletion once', async () => {
    const source = await readFile(routePath, 'utf8');
    const routeStart = source.indexOf("router.delete('/:letterId'");
    const routeEnd = source.indexOf(
      "router.patch('/pages/:pageId/line-segments'",
      routeStart,
    );
    const route = source.slice(routeStart, routeEnd);

    expect(route).toContain('requirePrimarySourceRevision(');
    expect(route).toContain(
      'deleteCorrespondenceGroup(\n      letterId,\n      primarySourceRevision,',
    );
    expect(route.match(/deleteCorrespondenceGroup\(/g)).toHaveLength(1);
  });

  it('reclaims snapshotted paths through one reference owner only after commit', async () => {
    const source = await readFile(servicePath, 'utf8');
    const transactionStart = source.indexOf(
      'const committed = await database.transaction(',
    );
    const transactionResolved = source.indexOf(
      'if (!committed) return null;',
      transactionStart,
    );
    const pageSnapshot = source.indexOf(
      'storagePath: letterPages.storagePath',
      transactionStart,
    );
    const storagePathsSnapshot = source.indexOf(
      'const storagePaths = Array.from(',
      pageSnapshot,
    );
    const reclaimerBinding = source.match(
      /const\s+(\w+)\s*=\s*dependencies\.\w+\s*\?\?\s*reclaimUnreferencedPageStoragePath\s*;/,
    );

    expect(source).toContain(
      "from '../storage-reference-cleanup.js'",
    );
    expect(source).not.toContain(
      "import { removeStoredFile } from '../storage.js'",
    );
    expect(transactionStart).toBeGreaterThan(-1);
    expect(pageSnapshot).toBeGreaterThan(transactionStart);
    expect(storagePathsSnapshot).toBeGreaterThan(pageSnapshot);
    expect(transactionResolved).toBeGreaterThan(storagePathsSnapshot);
    expect(reclaimerBinding).not.toBeNull();

    const reclaimerName = reclaimerBinding?.[1] ?? '';
    const postCommitSource = source.slice(transactionResolved);
    expect(postCommitSource).toContain(
      'for (const storagePath of committed.storagePaths)',
    );
    expect(postCommitSource).toContain(
      `await ${reclaimerName}(storagePath)`,
    );
    expect(source.slice(transactionStart, transactionResolved)).not.toContain(
      `${reclaimerName}(storagePath)`,
    );
  });

  it('unlinks only immutable page objects with no exact live reference', async () => {
    const source = await readFile(storageReferenceCleanupPath, 'utf8');
    const helper = exportedFunction(
      source,
      'reclaimUnreferencedPageStoragePath',
    );
    const referenceLookupStart = source.indexOf(
      'async function findPageReference(',
    );
    const referenceLookupEnd = source.indexOf('/**', referenceLookupStart);
    const referenceLookup = source.slice(
      referenceLookupStart,
      referenceLookupEnd,
    );
    const immutableGuard = helper.indexOf(
      'if (!isImmutableStoragePath(storagePath))',
    );
    const lookupBinding = helper.match(
      /const\s+(\w+)\s*=\s*dependencies\.\w+\s*\?\?\s*findPageReference\s*;/,
    );
    const removerBinding = helper.match(
      /const\s+(\w+)\s*=\s*dependencies\.\w+\s*\?\?\s*removeStoredFile\s*;/,
    );

    expect(referenceLookupStart).toBeGreaterThan(-1);
    expect(referenceLookup).toContain(
      'eq(letterPages.storagePath, storagePath)',
    );
    expect(immutableGuard).toBeGreaterThan(-1);
    expect(lookupBinding).not.toBeNull();
    expect(removerBinding).not.toBeNull();

    const lookupName = lookupBinding?.[1] ?? '';
    const removerName = removerBinding?.[1] ?? '';
    const exactReferenceQuery = helper.indexOf(
      `await ${lookupName}(storagePath)`,
      immutableGuard,
    );
    const unlink = helper.indexOf(
      `await ${removerName}(storagePath)`,
      exactReferenceQuery,
    );
    expect(exactReferenceQuery).toBeGreaterThan(immutableGuard);
    expect(helper.slice(immutableGuard, exactReferenceQuery)).toContain(
      'return',
    );
    expect(unlink).toBeGreaterThan(exactReferenceQuery);
    expect(helper.slice(exactReferenceQuery, unlink)).toMatch(
      /if\s*\([\s\S]*?\breturn\b/,
    );
  });
});
