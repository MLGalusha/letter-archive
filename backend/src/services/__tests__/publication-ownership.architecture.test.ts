import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const sourceRoot = fileURLToPath(root);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), 'utf8');
}

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return productionTypeScriptFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolutePath] : [];
  }));
  return nested.flat();
}

describe('publication mutation ownership', () => {
  it('keeps bulk routes as validation/adaptation instead of a second writer', async () => {
    const bulkRoute = await source('routes/admin/letters/bulk.ts');

    expect(bulkRoute).toContain('applyBulkPublicationAction');
    expect(bulkRoute).not.toContain('getPublicationSourceSnapshots');
    expect(bulkRoute).not.toContain('content-visibility-sources');
    expect(bulkRoute).not.toMatch(/db\s*\.\s*update\s*\(\s*letters\s*\)/);
  });

  it('routes ordinary publication-bearing saves through the same owner', async () => {
    const letterOperations = await source('services/letter-operations.ts');

    expect(letterOperations).toContain('applyPublicationMutation');
    expect(letterOperations).not.toContain('Companion types visibility synced');
  });

  it('owns transaction, group lock, and profile invalidation together', async () => {
    const publication = await source(
      'services/letter/publication-mutations.ts',
    );

    expect(publication).toContain('db.transaction');
    expect(publication).toContain('lockCorrespondenceGroupByLetterId');
    expect(publication).toContain('advanceCollectionProfileRevision');
  });

  it('keeps every production authority-granting letter update in the canonical owner', async () => {
    const authorityWriters: string[] = [];
    const publicGrant = /(?:visibility\s*:\s*['"]PUBLISHED['"]|transcriptPublished\s*:\s*true|metadataPublished\s*:\s*true)/;

    for (const absolutePath of await productionTypeScriptFiles(sourceRoot)) {
      const contents = await readFile(absolutePath, 'utf8');
      if (
        /\.update\(\s*letters\s*\)/.test(contents)
        && publicGrant.test(contents)
      ) {
        authorityWriters.push(path.relative(sourceRoot, absolutePath));
      }
    }

    expect(authorityWriters).toEqual([
      'services/letter/publication-mutations.ts',
    ]);
  });
});
