import { parseFilename, isValidFilename } from './filename-parser.js';
import sharp from 'sharp';
import {
  buildStoragePath,
  computeChecksum,
  getAbsoluteStoragePath,
  inspectUploadFile,
  isImmutableStoragePath,
  removeStoredFile,
  storeImmutableFile,
} from './storage.js';
import {
  findOrCreateCollection,
  getCollectionByCode,
  getCollectionById,
} from './collections.js';
import {
  findLetterByIdentity,
  type CreateLetterParams,
} from './letters.js';
import {
  findDurableContentDuplicateByIdentity,
  findOrCreatePage,
  getPage,
  type ExistingPagePolicy,
  type PageMutationOutcome,
  type PageMutationResult,
  type UploadSourceExpectation,
} from './letter-pages.js';
import type { Collection, Letter, LetterPage } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import {
  SourceRevisionChangedError,
  sourceRevisionChanged,
} from './letter/source-revision.js';
import { reclaimUnreferencedPageStoragePath } from './storage-reference-cleanup.js';
import { withContentChecksumLock } from './content-checksum-lock.js';

const log = createLogger({ module: 'upload' });

export interface UploadResult {
  collection: Collection;
  letter: Letter;
  page: LetterPage;
  storagePath: string;
  primarySourceRevision: number;
  alreadyExists: boolean;
  outcome: UploadOutcome;
  changed: boolean;
  duplicateReason?: DuplicateReason;
}

export type UploadOutcome = 'created' | 'replaced' | 'unchanged';
export type DuplicateReason = 'duplicate_content';

async function readImageDimensions(
  storagePath: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await sharp(getAbsoluteStoragePath(storagePath)).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

function uploadOutcome(outcome: PageMutationOutcome): UploadOutcome {
  if (outcome === 'created') return 'created';
  if (outcome === 'replaced') return 'replaced';
  return 'unchanged';
}

async function isDurableChecksumSource(
  page: LetterPage,
  checksumSha256: string,
): Promise<boolean> {
  try {
    return await computeChecksum(getAbsoluteStoragePath(page.storagePath))
      === checksumSha256;
  } catch {
    return false;
  }
}

/**
 * Processes an uploaded file:
 * 1. Parses the filename
 * 2. Creates/finds collection
 * 3. Reads any existing letter/page source
 * 4. Stores a candidate file when needed
 * 5. Commits letter membership and page source together
 *
 * @param force - If true, overwrites existing files instead of skipping
 */
async function processUploadedFileInternal(
  tempPath: string,
  originalFilename: string,
  force = false,
  expectedReplacementSource?: UploadSourceExpectation,
  contentLockHeld = false,
  inspectedFile?: Awaited<ReturnType<typeof inspectUploadFile>>,
): Promise<UploadResult> {
  const start = Date.now();
  const context = { originalFilename, force };

  log.debug(context, 'Processing uploaded file');

  // Validate and parse filename
  if (!isValidFilename(originalFilename)) {
    log.warn({ ...context, reason: 'invalid_format' }, 'Filename validation failed');
    throw new Error(
      `Invalid filename format: "${originalFilename}". Expected format: 003-18XX0706-L01-01.jpg`
    );
  }

  const parsed = parseFilename(originalFilename);
  if (!parsed) {
    log.warn({ ...context, reason: 'parse_failed' }, 'Filename parsing failed');
    throw new Error(`Failed to parse filename: "${originalFilename}"`);
  }

  log.debug(
    {
      ...context,
      collectionCode: parsed.collectionCode,
      dateRaw: parsed.dateRaw,
      type: parsed.type,
      typeSequence: parsed.typeSequence,
      pageNumber: parsed.pageNumber,
    },
    'Filename parsed successfully'
  );

  const inspectedUpload = force
    ? null
    : inspectedFile ?? await inspectUploadFile(tempPath);
  if (inspectedUpload && !contentLockHeld) {
    return withContentChecksumLock(
      inspectedUpload.checksumSha256,
      () => processUploadedFileInternal(
        tempPath,
        originalFilename,
        force,
        expectedReplacementSource,
        true,
        inspectedUpload,
      ),
    );
  }

  const observedCollection = await getCollectionByCode(parsed.collectionCode);
  const duplicate = inspectedUpload
    ? await findDurableContentDuplicateByIdentity(
        {
          ...(observedCollection ? { collectionId: observedCollection.id } : {}),
          dateRaw: parsed.dateRaw,
          type: parsed.type,
          typeSequence: parsed.typeSequence,
          pageNumber: parsed.pageNumber,
        },
        {
          checksumSha256: inspectedUpload.checksumSha256,
          isDurableSource: async (page) => {
            const durable = await isDurableChecksumSource(
              page,
              inspectedUpload.checksumSha256,
            );
            if (!durable) {
              log.warn(
                {
                  ...context,
                  existingPageId: page.id,
                  existingStoragePath: page.storagePath,
                },
                'Ignoring a content-hash match whose archived object is missing or corrupt',
              );
            }
            return durable;
          },
        },
      )
    : undefined;
  if (duplicate) {
    const duplicateCollection = await getCollectionById(
      duplicate.letter.collectionId,
    );
    if (!duplicateCollection) {
      throw new Error(
        `Content duplicate owner collection ${duplicate.letter.collectionId} could not be loaded`,
      );
    }
    log.info(
      {
        ...context,
        collectionId: duplicateCollection.id,
        letterId: duplicate.letter.id,
        pageId: duplicate.page.id,
        alreadyExists: true,
        outcome: 'unchanged',
        changed: false,
        duration: Date.now() - start,
      },
      'Upload source unchanged',
    );
    return {
      collection: duplicateCollection,
      letter: duplicate.letter,
      page: duplicate.page,
      storagePath: duplicate.page.storagePath,
      primarySourceRevision: duplicate.primarySourceRevision,
      alreadyExists: true,
      outcome: 'unchanged',
      changed: false,
      duplicateReason: 'duplicate_content',
    };
  }

  const collection = observedCollection
    ?? await findOrCreateCollection(parsed.collectionCode);
  log.debug({ ...context, collectionId: collection.id }, 'Collection resolved');

  const letterIdentity: CreateLetterParams = {
    collectionId: collection.id,
    dateRaw: parsed.dateRaw,
    type: parsed.type,
    typeSequence: parsed.typeSequence,
    letterDate: parsed.letterDate,
    dateConfidence: parsed.dateConfidence,
  };
  const observedLetter = await findLetterByIdentity({
    collectionId: letterIdentity.collectionId,
    dateRaw: letterIdentity.dateRaw,
    type: letterIdentity.type,
    typeSequence: letterIdentity.typeSequence,
  });
  const ownerObservation = observedLetter
    ? { kind: 'present' as const, letterId: observedLetter.id }
    : { kind: 'absent' as const };
  log.debug(
    { ...context, letterId: observedLetter?.id ?? null },
    'Letter identity observed',
  );

  const logicalPath = buildStoragePath(
    parsed.collectionCode,
    parsed.dateRaw,
    parsed.type,
    parsed.typeSequence,
    originalFilename
  );
  const existing = observedLetter
    ? await getPage(observedLetter.id, parsed.pageNumber)
    : undefined;
  if (force) {
    if (!expectedReplacementSource) {
      throw new Error(
        'Force replacement requires the source expectation returned by duplicate checking',
      );
    }
    if (
      !existing
      || existing.id !== expectedReplacementSource.pageId
      || existing.storagePath !== expectedReplacementSource.storagePath
      || existing.checksumSha256 !== expectedReplacementSource.checksumSha256
    ) {
      throw sourceRevisionChanged(
        'Page source changed after duplicate confirmation; check duplicates again before replacing it',
      );
    }
  }
  const expectedExistingSource = existing
    ? {
        storagePath: existing.storagePath,
        checksumSha256: existing.checksumSha256,
      }
    : undefined;

  let pageResult: PageMutationResult;
  let preparedStoragePath: string | null = null;
  const commitObservedSource = async (
    checksumSha256: string,
    policy: Extract<ExistingPagePolicy, 'keep' | 'replace'>,
  ) => {
    if (!existing) {
      throw new Error('Cannot confirm a page source that was not observed');
    }
    return findOrCreatePage({
      letterIdentity,
      ownerObservation,
      pageNumber: parsed.pageNumber,
      storagePath: existing.storagePath,
      originalFilename,
      checksumSha256,
      width: existing.width ?? null,
      height: existing.height ?? null,
      existingPagePolicy: policy,
      ...(force && expectedReplacementSource
        ? { expectedReplacementSource }
        : {}),
      ...(!force && expectedExistingSource
        ? { expectedExistingSource }
        : {}),
    });
  };
  const commitPreparedSource = async (
    stored: { storagePath: string; checksumSha256: string },
    policy: ExistingPagePolicy,
    committedOriginalFilename = originalFilename,
  ) => {
    preparedStoragePath = stored.storagePath;
    const dimensions = await readImageDimensions(stored.storagePath);
    try {
      return await findOrCreatePage({
        letterIdentity,
        ownerObservation,
        pageNumber: parsed.pageNumber,
        storagePath: stored.storagePath,
        originalFilename: committedOriginalFilename,
        checksumSha256: stored.checksumSha256,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        existingPagePolicy: policy,
        ...(force && expectedReplacementSource
          ? { expectedReplacementSource }
          : {}),
        ...(!force && policy !== 'replace' && expectedExistingSource
          ? { expectedExistingSource }
          : {}),
      });
    } catch (error) {
      if (error instanceof SourceRevisionChangedError) {
        await removeStoredFile(stored.storagePath).catch((cleanupError) => {
          log.warn(
            { ...context, storagePath: stored.storagePath, err: cleanupError },
            'Failed to remove a stale force-upload candidate',
          );
        });
        preparedStoragePath = null;
        throw error;
      }
      log.error(
        { ...context, storagePath: stored.storagePath, err: error },
        'Immutable file stored but database page commit failed',
      );
      throw new Error(
        `File stored at ${stored.storagePath}, but database reconciliation failed; retry the upload`,
        { cause: error },
      );
    }
  };

  if (existing && !force) {
    let actualChecksum: string | null = null;
    try {
      actualChecksum = await computeChecksum(
        getAbsoluteStoragePath(existing.storagePath),
      );
    } catch {
      // A matching upload can repair a missing legacy or immutable object.
    }

    if (
      actualChecksum !== null
      && actualChecksum === existing.checksumSha256
    ) {
      pageResult = await commitObservedSource(actualChecksum, 'keep');
    } else {
      const inspected = inspectedUpload ?? await inspectUploadFile(tempPath);
      if (inspected.checksumSha256 === existing.checksumSha256) {
        const stored = await storeImmutableFile(
          tempPath,
          logicalPath,
          inspected.checksumSha256,
        );
        pageResult = await commitPreparedSource(
          stored,
          actualChecksum === null ? 'repair' : 'invalidate',
        );
      } else if (actualChecksum !== null) {
        if (isImmutableStoragePath(existing.storagePath)) {
          throw new Error(
            'The committed immutable page object failed checksum verification; '
            + 'upload matching bytes or retry with force=true',
          );
        }
        const stored = await storeImmutableFile(
          getAbsoluteStoragePath(existing.storagePath),
          existing.storagePath,
          actualChecksum,
        );
        pageResult = await commitPreparedSource(
          stored,
          'invalidate',
          existing.originalFilename,
        );
      } else {
        throw new Error(
          'The committed page file is missing; upload matching bytes or retry with force=true',
        );
      }
    }
  } else {
    const inspected = inspectedUpload ?? await inspectUploadFile(tempPath);

    if (existing) {
      let actualChecksum: string | null = null;
      try {
        actualChecksum = await computeChecksum(
          getAbsoluteStoragePath(existing.storagePath),
        );
      } catch {
        // A unique replacement object can repair a missing current pointer.
      }

      if (
        actualChecksum === inspected.checksumSha256
        && existing.checksumSha256 === inspected.checksumSha256
      ) {
        pageResult = await commitObservedSource(
          inspected.checksumSha256,
          'replace',
        );
      } else if (
        actualChecksum === inspected.checksumSha256
        && actualChecksum !== existing.checksumSha256
      ) {
        const stored = await storeImmutableFile(
          tempPath,
          logicalPath,
          inspected.checksumSha256,
        );
        pageResult = await commitPreparedSource(stored, 'invalidate');
      } else {
        const stored = await storeImmutableFile(
          tempPath,
          logicalPath,
          inspected.checksumSha256,
        );
        const policy: ExistingPagePolicy =
          existing.checksumSha256 === stored.checksumSha256
            ? actualChecksum === null ? 'reconcile' : 'invalidate'
            : 'replace';
        pageResult = await commitPreparedSource(stored, policy);
      }
    } else {
      const stored = await storeImmutableFile(
        tempPath,
        logicalPath,
        inspected.checksumSha256,
      );
      pageResult = await commitPreparedSource(stored, force ? 'replace' : 'keep');
    }
  }

  if (
    preparedStoragePath
    && pageResult.page.storagePath !== preparedStoragePath
  ) {
    await removeStoredFile(preparedStoragePath).catch((error) => {
      log.warn(
        { ...context, storagePath: preparedStoragePath, err: error },
        'Failed to remove an unused immutable upload object',
      );
    });
  }

  const previousStoragePath = pageResult.previousStoragePath;
  if (
    previousStoragePath
    && previousStoragePath !== pageResult.page.storagePath
  ) {
    await reclaimUnreferencedPageStoragePath(previousStoragePath).catch((error) => {
      log.warn(
        { ...context, storagePath: previousStoragePath, err: error },
        'Failed to reclaim a superseded immutable page object',
      );
    });
  }

  const outcome = uploadOutcome(pageResult.outcome);
  const alreadyExists = outcome !== 'created';

  const duration = Date.now() - start;
  log.info(
    {
      ...context,
      collectionId: collection.id,
      letterId: pageResult.letter.id,
      pageId: pageResult.page.id,
      alreadyExists,
      outcome,
      changed: pageResult.sourceChanged,
      duration,
    },
    outcome === 'unchanged' ? 'Upload source unchanged' : 'Upload source committed',
  );

  return {
    collection,
    letter: pageResult.letter,
    page: pageResult.page,
    storagePath: pageResult.page.storagePath,
    primarySourceRevision: pageResult.primarySourceRevision,
    alreadyExists,
    outcome,
    changed: pageResult.sourceChanged,
  };
}

export async function processUploadedFile(
  tempPath: string,
  originalFilename: string,
  force = false,
  expectedReplacementSource?: UploadSourceExpectation,
): Promise<UploadResult> {
  return processUploadedFileInternal(
    tempPath,
    originalFilename,
    force,
    expectedReplacementSource,
  );
}
