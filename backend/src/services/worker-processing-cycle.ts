import { and } from 'drizzle-orm';
import { db, type Letter } from '../db/index.js';
import { processLetter, processMetadata } from '../pipeline/processor.js';
import { runEntityExtractionOnly } from '../pipeline/metadataV2.js';
import { createLogger } from '../utils/logger.js';
import { notify } from './notifications.js';
import { tryTranscribeExtras } from './letter/extra-content.js';
import {
  queuedEntityExtractionConditions,
  queuedExtraContentConditions,
  queuedMetadataConditions,
  queuedTranscriptionConditions,
} from './processing-eligibility.js';
import type { WorkerStateUpdate } from './worker-state.js';

const log = createLogger({ module: 'worker' });

export const WORKER_BATCH_SIZE = 5;

type WorkerCycleLetter = Pick<Letter, 'id' | 'collectionId' | 'dateRaw'>;

export interface WorkerCycleControl {
  executionToken: string;
  canStartOperation: () => boolean;
  publishState: (update: WorkerStateUpdate) => void;
}

type WorkerFailureType =
  | 'transcription_failed'
  | 'extra_content_failed'
  | 'metadata_failed'
  | 'entity_failed';

interface JobFailure {
  control: WorkerCycleControl;
  totalPending: number;
  job: WorkerCycleLetter;
  jobStart: number;
  error: unknown;
  type: WorkerFailureType;
  displayName: string;
}

async function findTranscriptionJobs(): Promise<WorkerCycleLetter[]> {
  return db.query.letters.findMany({
    where: and(...queuedTranscriptionConditions()),
    columns: { id: true, collectionId: true, dateRaw: true },
    limit: WORKER_BATCH_SIZE,
    orderBy: (letter, { asc }) => [asc(letter.createdAt)],
  });
}

async function findExtraContentJobs(): Promise<WorkerCycleLetter[]> {
  return db.query.letters.findMany({
    where: and(...queuedExtraContentConditions()),
    columns: { id: true, collectionId: true, dateRaw: true },
    limit: WORKER_BATCH_SIZE,
    orderBy: (letter, { asc }) => [asc(letter.createdAt)],
  });
}

async function findMetadataJobs(): Promise<WorkerCycleLetter[]> {
  return db.query.letters.findMany({
    where: and(...queuedMetadataConditions()),
    columns: { id: true, collectionId: true, dateRaw: true },
    limit: WORKER_BATCH_SIZE,
    orderBy: (letter, { asc }) => [asc(letter.createdAt)],
  });
}

async function findEntityJobs(): Promise<WorkerCycleLetter[]> {
  return db.query.letters.findMany({
    where: and(...queuedEntityExtractionConditions()),
    columns: { id: true, collectionId: true, dateRaw: true },
    limit: WORKER_BATCH_SIZE,
    orderBy: (letter, { asc }) => [asc(letter.createdAt)],
  });
}

function publishCycleState(
  control: WorkerCycleControl,
  currentBatchSize: number,
  lastError: string | null = null,
): void {
  control.publishState({
    lastError,
    currentBatchSize,
  });
}

function beginJob(
  control: WorkerCycleControl,
  totalPending: number,
  job: WorkerCycleLetter,
  workLabel: string,
): number {
  publishCycleState(control, totalPending);
  const jobStart = Date.now();
  log.info(
    {
      letterId: job.id,
      collectionId: job.collectionId,
      dateRaw: job.dateRaw,
    },
    `Starting ${workLabel} job`,
  );
  return jobStart;
}

function finishJob(
  control: WorkerCycleControl,
  totalPending: number,
  jobStart: number,
): number {
  publishCycleState(control, totalPending);
  return Date.now() - jobStart;
}

function reportJobFailure({
  control,
  totalPending,
  job,
  jobStart,
  error,
  type,
  displayName,
}: JobFailure): void {
  const duration = Date.now() - jobStart;
  const message = error instanceof Error ? error.message : 'Unknown error';
  publishCycleState(control, totalPending, message);
  log.error(
    { letterId: job.id, duration, err: error },
    `${displayName} job failed`,
  );
  void notify({
    type,
    title: `${displayName} failed`,
    message,
    link: `/admin/letters/${job.id}`,
    sourceType: 'letter',
    sourceId: job.id,
    metadata: {
      error: message,
      durationMs: duration,
      dateRaw: job.dateRaw,
    },
    dedupeKey: `${type}:${job.id}`,
  });
}

async function processTranscriptionJobs(
  jobs: WorkerCycleLetter[],
  totalPending: number,
  control: WorkerCycleControl,
): Promise<boolean> {
  if (jobs.length > 0) {
    log.debug({ count: jobs.length }, 'Found letters needing transcription');
  }

  for (const job of jobs) {
    if (!control.canStartOperation()) return false;

    const jobStart = beginJob(control, totalPending, job, 'transcription');
    try {
      const outcome = await processLetter(job.id, {
        extraContent: 'skip',
        workerExecutionToken: control.executionToken,
      });
      const duration = finishJob(control, totalPending, jobStart);
      if (outcome) {
        log.info(
          { letterId: job.id, duration, reason: outcome.reason },
          'Transcription job skipped',
        );
        continue;
      }

      log.info(
        { letterId: job.id, duration },
        'Transcription job completed',
      );
      void notify({
        type: 'transcription_success',
        title: 'Letter transcribed',
        message: `${job.dateRaw ?? job.id.slice(0, 8)} transcribed in ${(duration / 1000).toFixed(1)}s`,
        link: `/admin/letters/${job.id}`,
        sourceType: 'letter',
        sourceId: job.id,
        metadata: { durationMs: duration, dateRaw: job.dateRaw },
      });
    } catch (error) {
      reportJobFailure({
        control,
        totalPending,
        job,
        jobStart,
        error,
        type: 'transcription_failed',
        displayName: 'Transcription',
      });
    }
  }

  return true;
}

async function processExtraContentJobs(
  jobs: WorkerCycleLetter[],
  totalPending: number,
  control: WorkerCycleControl,
): Promise<boolean> {
  if (jobs.length > 0) {
    log.debug(
      { count: jobs.length },
      'Found letters needing extra-content transcription',
    );
  }

  // Supplementary content stays ahead of metadata so the metadata claim
  // reloads the latest extra-content transcript and source revision.
  for (const job of jobs) {
    if (!control.canStartOperation()) return false;

    const jobStart = beginJob(
      control,
      totalPending,
      job,
      'extra-content transcription',
    );
    try {
      const outcome = await tryTranscribeExtras(job.id, {
        expectedStatus: 'PENDING',
        claimKind: 'QUEUED',
        workerExecutionToken: control.executionToken,
      });
      const duration = finishJob(control, totalPending, jobStart);
      if (outcome.kind !== 'completed') {
        log.info(
          { letterId: job.id, duration, reason: outcome.kind },
          'Extra-content transcription job skipped',
        );
        continue;
      }

      log.info(
        { letterId: job.id, duration },
        'Extra-content transcription job completed',
      );
    } catch (error) {
      reportJobFailure({
        control,
        totalPending,
        job,
        jobStart,
        error,
        type: 'extra_content_failed',
        displayName: 'Extra-content transcription',
      });
    }
  }

  return true;
}

async function processMetadataJobs(
  jobs: WorkerCycleLetter[],
  totalPending: number,
  control: WorkerCycleControl,
): Promise<boolean> {
  if (jobs.length > 0) {
    log.debug(
      { count: jobs.length },
      'Found letters needing metadata extraction',
    );
  }

  for (const job of jobs) {
    if (!control.canStartOperation()) return false;

    const jobStart = beginJob(
      control,
      totalPending,
      job,
      'metadata extraction',
    );
    try {
      const outcome = await processMetadata(job.id, {
        entityExtraction: 'deferred',
        workerExecutionToken: control.executionToken,
      });
      const duration = finishJob(control, totalPending, jobStart);
      if (outcome?.kind === 'skipped') {
        log.info(
          { letterId: job.id, duration, reason: outcome.reason },
          'Metadata extraction job skipped',
        );
        continue;
      }

      log.info(
        { letterId: job.id, duration },
        'Metadata extraction job completed',
      );
      // Metadata success is published inside the pipeline.
    } catch (error) {
      reportJobFailure({
        control,
        totalPending,
        job,
        jobStart,
        error,
        type: 'metadata_failed',
        displayName: 'Metadata extraction',
      });
    }
  }

  return true;
}

async function processEntityJobs(
  jobs: WorkerCycleLetter[],
  totalPending: number,
  control: WorkerCycleControl,
): Promise<boolean> {
  if (jobs.length > 0) {
    log.debug(
      { count: jobs.length },
      'Found letters needing entity extraction',
    );
  }

  for (const job of jobs) {
    if (!control.canStartOperation()) return false;

    const jobStart = beginJob(
      control,
      totalPending,
      job,
      'entity extraction',
    );
    try {
      await runEntityExtractionOnly(job.id, {
        workerExecutionToken: control.executionToken,
      });
      const duration = finishJob(control, totalPending, jobStart);
      log.info(
        { letterId: job.id, duration },
        'Entity extraction job completed',
      );
      // Entity success is published inside the pipeline.
    } catch (error) {
      reportJobFailure({
        control,
        totalPending,
        job,
        jobStart,
        error,
        type: 'entity_failed',
        displayName: 'Entity extraction',
      });
    }
  }

  return true;
}

export async function processWorkerCycle(
  control: WorkerCycleControl,
): Promise<boolean> {
  const cycleStart = Date.now();

  // Discovery remains eager and sequential. Work created while these
  // snapshotted batches run is intentionally left for the next durable cycle.
  if (!control.canStartOperation()) return false;
  const transcriptionJobs = await findTranscriptionJobs();
  if (!control.canStartOperation()) return false;
  const extraContentJobs = await findExtraContentJobs();
  if (!control.canStartOperation()) return false;
  const metadataJobs = await findMetadataJobs();
  if (!control.canStartOperation()) return false;
  const entityJobs = await findEntityJobs();
  if (!control.canStartOperation()) return false;

  const totalPending =
    transcriptionJobs.length
    + extraContentJobs.length
    + metadataJobs.length
    + entityJobs.length;
  publishCycleState(control, totalPending);

  if (!await processTranscriptionJobs(
    transcriptionJobs,
    totalPending,
    control,
  )) {
    return totalPending > 0;
  }
  if (!await processExtraContentJobs(
    extraContentJobs,
    totalPending,
    control,
  )) {
    return totalPending > 0;
  }
  if (!await processMetadataJobs(metadataJobs, totalPending, control)) {
    return totalPending > 0;
  }
  if (!await processEntityJobs(entityJobs, totalPending, control)) {
    return totalPending > 0;
  }

  if (totalPending > 0) {
    log.info(
      {
        transcriptionCount: transcriptionJobs.length,
        extraContentCount: extraContentJobs.length,
        metadataCount: metadataJobs.length,
        entityCount: entityJobs.length,
        totalProcessed: totalPending,
        cycleDuration: Date.now() - cycleStart,
      },
      'Processing cycle completed',
    );
  }

  return totalPending > 0;
}
