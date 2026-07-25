import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));

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

function exportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start === -1) {
    throw new Error(`Could not find exported function ${name}`);
  }
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('page source ownership architecture', () => {
  it('keeps source invalidation behind the transactional page owner', async () => {
    const callers: string[] = [];
    for (const absolutePath of await productionTypeScriptFiles(sourceRoot)) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'services/letter/page-source-invalidation.ts') continue;
      const source = await readFile(absolutePath, 'utf8');
      if (
        /\binvalidatePrimaryLetterSource\s*\(/.test(source)
        || /\binvalidateExtraContentSource\s*\(/.test(source)
        || /\binvalidateRelatedPageSource\s*\(/.test(source)
      ) {
        callers.push(relativePath);
      }
    }

    expect(callers).toEqual(['services/letter-pages.ts']);
  });

  it('keeps page source pointer writes in one service', async () => {
    const writers: string[] = [];
    for (const absolutePath of await productionTypeScriptFiles(sourceRoot)) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      const source = await readFile(absolutePath, 'utf8');
      const pageMutations = source.match(
        /\.(?:update|insert)\(letterPages\)[\s\S]*?\.(?:where|returning)\(/g,
      ) ?? [];
      if (pageMutations.some((mutation) => (
        /(?:storagePath|checksumSha256)\s*:/.test(mutation)
      ))) {
        writers.push(relativePath);
      }
    }

    expect(writers).toEqual(['services/letter-pages.ts']);
  });

  it('keeps the transactional page owner behind the upload service', async () => {
    const callers: string[] = [];
    for (const absolutePath of await productionTypeScriptFiles(sourceRoot)) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      if (relativePath === 'services/letter-pages.ts') continue;

      const source = await readFile(absolutePath, 'utf8');
      if (/\bfindOrCreatePage\s*\(/.test(source)) {
        callers.push(relativePath);
      }
    }

    expect(callers).toEqual(['services/upload.ts']);
  });

  it('derives source effects from the locked owner instead of trusting callers', async () => {
    const pageOwner = await readFile(
      path.join(sourceRoot, 'services/letter-pages.ts'),
      'utf8',
    );

    expect(pageOwner).toContain('function pageChangeEffectForOwner');
    expect(pageOwner).toMatch(
      /lockCorrespondenceGroupByIdentity\([\s\S]*?resolvePageOwner\([\s\S]*?pageChangeEffectForOwner\(sourceGroup\.owner\)/,
    );
    expect(pageOwner).not.toMatch(/interface CreatePageParams[\s\S]*?\beffect\s*:/);
    expect(pageOwner).toMatch(
      /lockCorrespondenceGroupByIdentity\([\s\S]*?const result = await persistPage\([\s\S]*?if \(!result\.sourceChanged\)[\s\S]*?primarySourceRevision: sourceGroup\.owner\.primarySourceRevision/,
    );
    expect(pageOwner).toMatch(
      /primarySourceRevision: sourceGroup\.nextSourceRevision/,
    );
  });

  it('locks every correspondence member by identity before page persistence', async () => {
    const [pageOwner, correspondenceGroup] = await Promise.all([
      readFile(path.join(sourceRoot, 'services/letter-pages.ts'), 'utf8'),
      readFile(
        path.join(sourceRoot, 'services/letter/correspondence-group.ts'),
        'utf8',
      ),
    ]);
    const identityLock = exportedFunction(
      correspondenceGroup,
      'lockCorrespondenceGroupByIdentity',
    );

    expect(identityLock).toMatch(
      /\.orderBy\(asc\(letters\.id\)\)[\s\S]*?\.for\('update'\)/,
    );
    expect(identityLock.indexOf(".for('update')"))
      .toBeLessThan(identityLock.indexOf('.orderBy(asc(letters.id))'));
    const pageTransaction = exportedFunction(pageOwner, 'findOrCreatePage');
    expect(pageTransaction.indexOf('lockCorrespondenceGroupByIdentity('))
      .toBeLessThan(pageTransaction.indexOf('persistPage('));
  });

  it('keeps correspondence membership creation inside the transactional page owner', async () => {
    const letterWriters: string[] = [];
    const ownerResolverReferences: string[] = [];
    for (const absolutePath of await productionTypeScriptFiles(sourceRoot)) {
      const relativePath = path.relative(sourceRoot, absolutePath);
      const source = await readFile(absolutePath, 'utf8');
      if (/\.insert\(letters\)/.test(source)) {
        letterWriters.push(relativePath);
      }
      if (/\bresolvePageOwner\s*\(/.test(source)) {
        ownerResolverReferences.push(relativePath);
      }
    }

    expect(letterWriters).toEqual(['services/letter-pages.ts']);
    expect(ownerResolverReferences).toEqual(['services/letter-pages.ts']);

    const [pageOwner, lettersService, upload] = await Promise.all([
      readFile(path.join(sourceRoot, 'services/letter-pages.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letters.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/upload.ts'), 'utf8'),
    ]);

    expect(pageOwner).toContain('letterIdentity: CreateLetterParams');
    expect(pageOwner).toContain('ownerObservation: LetterOwnerObservation');
    const createPageParams = pageOwner.slice(
      pageOwner.indexOf('export interface CreatePageParams'),
      pageOwner.indexOf('\n}\n', pageOwner.indexOf('export interface CreatePageParams')) + 3,
    );
    expect(createPageParams).not.toMatch(
      /\n\s+(?:collectionId|letterId): string;/,
    );
    const resolverStart = pageOwner.indexOf('async function resolvePageOwner');
    const resolverEnd = pageOwner.indexOf(
      '\nfunction pageChangeEffectForOwner',
      resolverStart,
    );
    expect(resolverStart).toBeGreaterThanOrEqual(0);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    const ownerResolver = pageOwner.slice(resolverStart, resolverEnd);
    const pageOwnerOutsideResolver =
      pageOwner.slice(0, resolverStart) + pageOwner.slice(resolverEnd);
    expect(ownerResolver.match(/\.insert\(letters\)/g)).toHaveLength(1);
    expect(pageOwnerOutsideResolver).not.toMatch(/\.insert\(letters\)/);
    expect(pageOwner.match(/\bresolvePageOwner\s*\(/g)).toHaveLength(2);

    const pageMutation = exportedFunction(pageOwner, 'findOrCreatePage');
    expect(pageMutation).toContain('return db.transaction(async (tx) =>');
    expect(pageMutation).toContain('lockCorrespondenceGroupByIdentity(');
    expect(pageMutation).toMatch(/resolvePageOwner\(\s*params,\s*locked,\s*tx,/);
    expect(pageMutation.indexOf('return db.transaction(async (tx) =>'))
      .toBeLessThan(pageMutation.indexOf('resolvePageOwner('));
    expect(pageMutation).toContain('persistPage(');
    expect(pageOwner).toContain('params.ownerObservation.kind');

    expect(lettersService).toContain('export async function findLetterByIdentity');
    expect(lettersService).not.toContain('export async function findOrCreateLetter');
    expect(upload).toContain('findLetterByIdentity');
    expect(upload).not.toContain('findOrCreateLetter');
    expect(upload).toContain('const ownerObservation = observedLetter');
    expect(upload).toMatch(/findOrCreatePage\(\{[\s\S]*?\bownerObservation,/);
    expect(upload).toContain("kind: 'present'");
    expect(upload).toContain("kind: 'absent'");
  });

  it('assigns every page-bearing type an explicit source invalidation effect', async () => {
    const pageOwner = await readFile(
      path.join(sourceRoot, 'services/letter-pages.ts'),
      'utf8',
    );
    const effect = pageOwner.slice(
      pageOwner.indexOf('function pageChangeEffectForOwner'),
      pageOwner.indexOf('/**\n * Finds an existing page'),
    );

    for (const type of ['L', 'T', 'C', 'E', 'P', 'V', 'A', 'D', 'N']) {
      expect(effect).toContain(`case '${type}':`);
    }
    expect(effect).toContain("return { kind: 'related-page' }");
    expect(effect).toContain('const unsupportedType: never = owner.type');
  });

  it('materializes immutable candidates and never overwrites a live object', async () => {
    const [storage, upload, pageOwner, uploadRoute] = await Promise.all([
      readFile(path.join(sourceRoot, 'services/storage.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/upload.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letter-pages.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'routes/admin/uploads.ts'), 'utf8'),
    ]);

    expect(storage).toContain('COPYFILE_EXCL');
    expect(storage).toContain('copiedByThisAttempt');
    expect(storage).toContain('Stored upload checksum does not match');
    expect(storage).toMatch(/objectId\s*=\s*randomUUID\(\)/);
    expect(storage).toContain('`${checksumSha256}-${objectId}${extension.toLowerCase()}`');
    expect(upload).toContain('storeImmutableFile');
    expect(upload).toContain('expectedExistingSource');
    expect(upload).not.toContain('overwriteFile');
    expect(upload).not.toContain('rename(');

    expect(uploadRoute).toContain('findObservedPageSourcesByIdentity');
    expect(uploadRoute).toContain('sourceExpectations');
    expect(uploadRoute).toMatch(
      /processUploadedFile\([\s\S]*?force \? sourceExpectations\[file\.originalname\] : undefined/,
    );
    expect(upload).toContain('expectedReplacementSource');
    expect(upload).toContain('SourceRevisionChangedError');
    expect(upload).toContain('removeStoredFile(stored.storagePath)');
    expect(pageOwner).toContain(
      'sourceGroup.owner.primarySourceRevision',
    );
    expect(pageOwner).toContain(
      'existing.id !== expectedReplacement.pageId',
    );
    expect(pageOwner).toContain(
      'existing.storagePath !== expectedReplacement.storagePath',
    );
    expect(pageOwner).toContain(
      'existing.checksumSha256 !== expectedReplacement.checksumSha256',
    );
  });

  it('fences every source-derived admin authority surfaced by this slice', async () => {
    const [
      lineSegments,
      readingView,
      contentRoute,
      letterOperations,
      bulkOperations,
      bulkRoute,
      collectionRoute,
      collectionProfileMutations,
      regeneration,
      verification,
      sourceRevision,
      noteMutations,
    ] = await Promise.all([
      readFile(path.join(sourceRoot, 'services/line-segments.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letter/readingView.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'routes/admin/letters/content.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letter-operations.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letter/bulk-operations.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'routes/admin/letters/bulk.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'routes/admin/collections.ts'), 'utf8'),
      readFile(
        path.join(sourceRoot, 'services/collection-profile-mutations.ts'),
        'utf8',
      ),
      readFile(path.join(sourceRoot, 'services/letter/regeneration.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letter/verification.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letter/source-revision.ts'), 'utf8'),
      readFile(path.join(sourceRoot, 'services/letter/ai-notes.ts'), 'utf8'),
    ]);

    for (const source of [lineSegments, readingView, letterOperations, bulkRoute]) {
      expect(source).toContain('primarySourceRevision');
    }
    const readingViewWriter = exportedFunction(
      readingView,
      'generateAndSaveReadingView',
    );
    expect(readingViewWriter).toContain('expectedPrimarySourceRevision');
    expect(readingViewWriter).toContain('assertCurrentPrimarySourceRevision(');
    expect(readingViewWriter).toContain(
      'eq(letters.primarySourceRevision, expectedPrimarySourceRevision)',
    );
    expect(contentRoute).toMatch(
      /router\.post\('\/:letterId\/generate-reading-view'[\s\S]*?requirePrimarySourceRevision\([\s\S]*?generateAndSaveReadingView\([\s\S]*?primarySourceRevision/,
    );
    for (const name of [
      'bulkTranscribe',
      'bulkExtractMetadata',
      'bulkClearTranscriptions',
      'bulkClearMetadata',
    ]) {
      const writer = exportedFunction(bulkOperations, name);
      expect(writer).toContain('sources: BulkSourceEntry[]');
      expect(writer).toContain('source.primarySourceRevision');
      expect(writer).toContain('expectedSourceCondition');
      expect(writer).toContain('SOURCE_CHANGED');
    }
    expect(bulkOperations).toMatch(
      /function expectedSourceCondition[\s\S]*?eq\(letters\.id, source\.letterId\)[\s\S]*?eq\(letters\.primarySourceRevision, source\.primarySourceRevision\)/,
    );
    for (const [path, schema, service] of [
      ['/transcribe', 'bulkTranscribeSchema', 'bulkTranscribe'],
      ['/extract-metadata', 'bulkSourceRequestSchema', 'bulkExtractMetadata'],
      ['/clear-transcriptions', 'bulkSourceRequestSchema', 'bulkClearTranscriptions'],
      ['/clear-metadata', 'bulkSourceRequestSchema', 'bulkClearMetadata'],
    ]) {
      expect(bulkRoute).toMatch(new RegExp(
        `router\\.post\\('${path}'[\\s\\S]*?${schema}[\\s\\S]*?${service}\\(sources`,
      ));
    }
    expect(lineSegments).toContain('sourceChecksum');
    expect(collectionRoute).toContain('profileRevision');
    expect(collectionRoute).toContain('updateCollectionProfile({');
    expect(collectionProfileMutations).toContain(
      'eq(collections.profileRevision, input.expectedProfileRevision)',
    );

    expect(sourceRevision).toContain(
      'eq(letters.primarySourceRevision, expectedRevision)',
    );
    for (const name of [
      'updateExtraContent',
      'describePhoto',
      'updatePhotoDescription',
    ]) {
      const writer = exportedFunction(regeneration, name);
      expect(writer).toContain('expectedPrimarySourceRevision');
      expect(writer).toContain('assertCurrentPrimarySourceRevision(');
      expect(writer).toContain(
        'currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision)',
      );
      expect(writer).toContain('.returning({ id: letters.id })');
    }
    for (const name of [
      'verifyTranscript',
      'unverifyTranscript',
      'verifyMetadata',
      'unverifyMetadata',
      'verifyExtraContent',
      'unverifyExtraContent',
      'verifyPhotoDescription',
      'unverifyPhotoDescription',
    ]) {
      const writer = exportedFunction(verification, name);
      expect(writer).toContain('expectedPrimarySourceRevision');
      expect(writer).toContain('assertCurrentPrimarySourceRevision(');
      expect(writer).toContain(
        'currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision)',
      );
      expect(writer).toContain('.returning({ id: letters.id })');
    }

    for (const name of [
      'updateAiNotes',
      'addAiNote',
      'updateAiNoteStatus',
    ]) {
      const writer = exportedFunction(noteMutations, name);
      expect(writer).toContain('expectedPrimarySourceRevision');
      expect(noteMutations).toContain(
        'currentPrimarySourceRevisionCondition(expectedPrimarySourceRevision)',
      );
      expect(noteMutations).toContain(
        'observedMetadataRevisionConditions(letterId, existingLetter)',
      );
    }
    for (const [path, owner] of [
      ['/:letterId/ai-notes', 'updateAiNotes'],
      ['/:letterId/notes', 'addAiNote'],
      ['/:letterId/notes/:noteId', 'updateAiNoteStatus'],
    ]) {
      expect(contentRoute).toMatch(new RegExp(
        `router\\.(?:put|post|patch)\\('${path.replaceAll('/', '\\/')}[\\s\\S]*?requirePrimarySourceRevision\\([\\s\\S]*?${owner}\\(`,
      ));
    }
    expect(letterOperations).toContain('resolveAiNotesForChangedFields(');
    expect(letterOperations).toContain('dbUpdates.aiNotes = noteAutoResolution.notes');
  });
});
