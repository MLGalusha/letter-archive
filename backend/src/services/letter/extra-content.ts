import { and, eq, inArray } from 'drizzle-orm';
import {
  checkExtraContentForText,
  transcribeExtraContent,
} from '../../ai/openai.js';
import {
  db,
  letters,
  type ExtraContentClaimKind,
  type JobStatus,
} from '../../db/index.js';
import { getAbsoluteStoragePath } from '../storage.js';
import { createLogger } from '../../utils/logger.js';
import {
  getDocumentTypeFromCode,
  observedTimestampMatches,
  type TranscribeExtrasResult,
} from './shared.js';
import {
  runExtraContentJob,
  type ExtraContentHeartbeat,
  type ExtraContentJobResult,
  type ExtraContentPatch,
} from './extra-content-job.js';
import { buildMetadataSourceInvalidationPatch } from './metadata-job.js';

const log = createLogger({ module: 'extra-content' });

type ClaimableJobStatus = Exclude<JobStatus, 'RUNNING'>;

class ExtraContentOwnershipLostError extends Error {}

function requireOwnership(heartbeat: ExtraContentHeartbeat): void {
  if (!heartbeat.hasOwnership()) throw new ExtraContentOwnershipLostError();
}

type ExtraContentExecution<T> =
  | ExtraContentJobResult<T>
  | { kind: 'missing' }
  | { kind: 'ineligible'; value: T };

async function loadExtraContentSource(letterId: string) {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: { collection: true },
  });
  if (!letter) return null;

  const relatedItems = await db.query.letters.findMany({
    where: and(
      eq(letters.collectionId, letter.collectionId),
      eq(letters.dateRaw, letter.dateRaw),
      eq(letters.typeSequence, letter.typeSequence),
      inArray(letters.type, ['T', 'C', 'E']),
    ),
    with: {
      pages: { orderBy: (page, { asc }) => [asc(page.pageNumber)] },
    },
    orderBy: (related, { asc }) => [asc(related.type)],
  });

  return { letter, relatedItems };
}

type ExtraContentSource = NonNullable<Awaited<ReturnType<typeof loadExtraContentSource>>>;

function contentPatch(transcript: string): ExtraContentPatch {
  return {
    extraContentTranscript: transcript || null,
    extraContentStatus: transcript ? 'AI_DRAFT' : 'EMPTY',
    extraContentVerifiedAt: null,
    extraContentVerifiedBy: null,
  };
}

function orderedRelatedItems(source: ExtraContentSource) {
  return [
    ...source.relatedItems.filter(item => item.type !== 'C'),
    ...source.relatedItems.filter(item => item.type === 'C'),
  ];
}

async function produceAutomaticExtras(
  source: ExtraContentSource,
  heartbeat: ExtraContentHeartbeat,
) {
  const { letter } = source;
  const typeCounters: Record<string, number> = {};
  const transcriptions: { type: string; index: number; text: string }[] = [];

  for (const item of orderedRelatedItems(source)) {
    requireOwnership(heartbeat);
    const documentType = getDocumentTypeFromCode(item.type);
    typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
    const typeIndex = typeCounters[item.type];

    for (const page of item.pages) {
      requireOwnership(heartbeat);
      const transcription = await transcribeExtraContent({
        filePath: getAbsoluteStoragePath(page.storagePath),
        letterId: letter.id,
        documentType,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
        },
      });
      requireOwnership(heartbeat);

      if (transcription.text.trim()) {
        transcriptions.push({
          type: documentType,
          index: typeIndex,
          text: transcription.text.replace(/^\n+|\n+$/g, ''),
        });
      }
    }
  }

  const transcript = transcriptions
    .map(({ type, index, text }) => {
      const displayName = type.charAt(0).toUpperCase() + type.slice(1);
      return `--- ${displayName} ${index} ---\n\n${text}`;
    })
    .join('\n\n');

  return {
    value: transcriptions.length,
    patch: contentPatch(transcript),
  };
}

async function produceRegeneratedExtras(
  source: ExtraContentSource,
  heartbeat: ExtraContentHeartbeat,
) {
  const { letter } = source;
  const typeCounters: Record<string, number> = {};
  const transcriptions: { type: string; index: number; text: string }[] = [];

  for (const item of orderedRelatedItems(source)) {
    requireOwnership(heartbeat);
    const documentType = getDocumentTypeFromCode(item.type);
    typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
    const typeIndex = typeCounters[item.type];

    for (const page of item.pages) {
      requireOwnership(heartbeat);
      const filePath = getAbsoluteStoragePath(page.storagePath);
      const check = await checkExtraContentForText({
        filePath,
        letterId: letter.id,
        documentType,
      });
      requireOwnership(heartbeat);
      if (!check.hasTranscribableText) continue;

      const transcription = await transcribeExtraContent({
        filePath,
        letterId: letter.id,
        documentType,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
        },
      });
      requireOwnership(heartbeat);

      if (transcription.text.trim()) {
        transcriptions.push({
          type: documentType,
          index: typeIndex,
          text: transcription.text.trim(),
        });
      }
    }
  }

  const transcript = transcriptions
    .map(({ type, index, text }) => {
      const displayName = type.charAt(0).toUpperCase() + type.slice(1);
      return `--- ${displayName} ${index} ---\n\n${text}`;
    })
    .join('\n\n');

  return {
    value: transcriptions.length,
    patch: contentPatch(transcript),
  };
}

async function produceStandaloneExtras(
  source: ExtraContentSource,
  heartbeat: ExtraContentHeartbeat,
) {
  const { letter, relatedItems } = source;
  const typeCounters: Record<string, number> = {};
  const typeTotals: Record<string, number> = {};
  const transcriptions: { type: string; index: number; text: string }[] = [];

  for (const item of relatedItems) {
    typeTotals[item.type] = (typeTotals[item.type] || 0) + 1;
  }

  for (const item of orderedRelatedItems(source)) {
    requireOwnership(heartbeat);
    const documentType = getDocumentTypeFromCode(item.type);
    typeCounters[item.type] = (typeCounters[item.type] || 0) + 1;
    const typeIndex = typeCounters[item.type];

    for (const page of item.pages) {
      requireOwnership(heartbeat);
      const filePath = getAbsoluteStoragePath(page.storagePath);
      const check = await checkExtraContentForText({
        filePath,
        letterId: letter.id,
        documentType,
      });
      requireOwnership(heartbeat);

      if (!check.hasTranscribableText) {
        log.debug(
          { pageId: page.id, type: item.type, reason: check.reason },
          'Skipping page - no transcribable text',
        );
        continue;
      }

      const transcription = await transcribeExtraContent({
        filePath,
        letterId: letter.id,
        documentType,
        context: {
          collectionCode: letter.collection.collectionCode,
          dateRaw: letter.dateRaw,
        },
      });
      requireOwnership(heartbeat);

      if (transcription.text?.trim()) {
        transcriptions.push({
          type: item.type,
          index: typeIndex,
          text: transcription.text.trim(),
        });
      }
    }
  }

  const transcript = transcriptions
    .map(({ type, index, text }) => {
      const documentType = getDocumentTypeFromCode(type);
      const displayName = documentType.charAt(0).toUpperCase() + documentType.slice(1);
      const label = typeTotals[type] > 1
        ? `--- ${displayName} ${index} ---`
        : `--- ${displayName} ---`;
      return `${label}\n\n${text}`;
    })
    .join('\n\n');

  const patch = contentPatch(transcript);
  return {
    value: {
      transcribedCount: transcriptions.length,
      extraContentStatus: patch.extraContentStatus,
    } satisfies TranscribeExtrasResult,
    patch,
  };
}

async function executeEligibleExtraContent<T>(
  letterId: string,
  expectedStatus: ClaimableJobStatus,
  expectedUpdatedAt: Date,
  claimKind: ExtraContentClaimKind,
  produce: (
    source: ExtraContentSource,
    heartbeat: ExtraContentHeartbeat,
  ) => Promise<{ value: T; patch: ExtraContentPatch }>,
): Promise<ExtraContentJobResult<T>> {
  return runExtraContentJob({
    letterId,
    expectedStatus,
    expectedUpdatedAt,
    claimKind,
    produce: async (heartbeat) => {
      const claimedSource = await loadExtraContentSource(letterId);
      if (!claimedSource) {
        throw new Error('Extra content source disappeared after the job was claimed');
      }
      requireOwnership(heartbeat);
      return produce(claimedSource, heartbeat);
    },
  });
}

function observedClaimableStatus(source: ExtraContentSource): ClaimableJobStatus | null {
  return source.letter.extraContentJobStatus === 'RUNNING'
    ? null
    : source.letter.extraContentJobStatus;
}

export async function runAutomaticExtraContent(
  letterId: string,
): Promise<ExtraContentExecution<number>> {
  const source = await loadExtraContentSource(letterId);
  if (!source) return { kind: 'missing' };
  if (source.relatedItems.length === 0) return { kind: 'ineligible', value: 0 };

  return executeEligibleExtraContent(
    letterId,
    'PENDING',
    source.letter.updatedAt,
    'QUEUED',
    produceAutomaticExtras,
  );
}

export async function runRegeneratedExtraContent(
  letterId: string,
): Promise<ExtraContentExecution<number>> {
  const source = await loadExtraContentSource(letterId);
  if (!source) return { kind: 'missing' };
  if (source.relatedItems.length === 0) return { kind: 'ineligible', value: 0 };

  const expectedStatus = observedClaimableStatus(source);
  if (!expectedStatus) return { kind: 'claim_lost' };
  return executeEligibleExtraContent(
    letterId,
    expectedStatus,
    source.letter.updatedAt,
    'REQUESTED',
    produceRegeneratedExtras,
  );
}

export async function tryTranscribeExtras(
  letterId: string,
  options: {
    expectedStatus?: ClaimableJobStatus;
    claimKind: ExtraContentClaimKind;
  },
): Promise<ExtraContentExecution<TranscribeExtrasResult>> {
  const source = await loadExtraContentSource(letterId);
  if (!source) return { kind: 'missing' };

  const expectedStatus = options.expectedStatus ?? observedClaimableStatus(source);
  if (!expectedStatus) return { kind: 'claim_lost' };

  if (source.relatedItems.length === 0) {
    const cleared = await db
      .update(letters)
      .set({
        extraContentStatus: 'EMPTY',
        extraContentTranscript: null,
        extraContentVerifiedAt: null,
        extraContentVerifiedBy: null,
        ...buildMetadataSourceInvalidationPatch(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(letters.id, letterId),
        eq(letters.extraContentJobStatus, expectedStatus),
        observedTimestampMatches(letters.updatedAt, source.letter.updatedAt),
      ))
      .returning({ id: letters.id });

    if (cleared.length === 0) return { kind: 'claim_lost' };

    return {
      kind: 'ineligible',
      value: {
        transcribedCount: 0,
        extraContentStatus: 'EMPTY',
        message: 'No extra content found to transcribe',
      },
    };
  }

  return executeEligibleExtraContent(
    letterId,
    expectedStatus,
    source.letter.updatedAt,
    options.claimKind,
    produceStandaloneExtras,
  );
}

function conflictError(message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = 409;
  return error;
}

export async function transcribeExtras(
  letterId: string,
): Promise<TranscribeExtrasResult | null> {
  const result = await tryTranscribeExtras(letterId, { claimKind: 'REQUESTED' });
  if (result.kind === 'missing') return null;
  if (result.kind === 'completed' || result.kind === 'ineligible') return result.value;
  if (result.kind === 'claim_lost') {
    throw conflictError('Extra content transcription conflicted with another job update');
  }
  throw conflictError('Extra content transcription was cancelled or superseded');
}
