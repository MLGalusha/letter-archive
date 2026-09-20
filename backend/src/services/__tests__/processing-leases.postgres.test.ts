import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row, Sql } from 'postgres';
import { eq } from 'drizzle-orm';
import type { MetadataV2 } from '../../ai/schemas/metadataV2.js';

// Opt-in because this starts an isolated PostgreSQL 16 container and applies the
// real migration journal. It never reads the developer's DATABASE_URL.
// npm run test:processing-leases:postgres
const enabled = process.env.PROCESSING_LEASES_POSTGRES_TEST === '1';

type Jobs = typeof import('../letter/transcription-job.js')
  & typeof import('../letter/metadata-job.js')
  & typeof import('../letter/entity-extraction-job.js')
  & typeof import('../letter/extra-content-job.js')
  & typeof import('../worker-state.js');

describe.skipIf(!enabled)('processing leases against PostgreSQL', { timeout: 15_000 }, () => {
  let container = '';
  let url = '';
  let verify: Sql;
  let locker: Sql;
  let jobs: Jobs;
  let database: typeof import('../../db/index.js');
  const collectionId = '19200000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    container = `letter-archive-processing-leases-${randomUUID()}`;
    execFileSync('docker', [
      'run', '--rm', '-d', '--name', container, '-e', 'POSTGRES_PASSWORD=fixture',
      '-e', 'POSTGRES_DB=processing_leases_fixture', '-p', '127.0.0.1::5432',
      'postgres:16-alpine', 'postgres',
      '-c', 'statement_timeout=10000', '-c', 'lock_timeout=7000',
    ], { stdio: 'ignore', timeout: 60_000 });
    const binding = execFileSync('docker', ['port', container, '5432'], {
      encoding: 'utf8', timeout: 10_000,
    }).trim();
    url = `postgresql://postgres:fixture@${binding}/processing_leases_fixture`;
    const postgres = (await import('postgres')).default;
    verify = postgres(url, { max: 1, connect_timeout: 1, connection: { application_name: 'processing-lease-verifier' } });
    locker = postgres(url, { max: 1, connect_timeout: 1, connection: { application_name: 'processing-lease-locker' } });
    for (let attempt = 0; ; attempt += 1) {
      try { await verify`select 1`; break; } catch (error) {
        if (attempt === 30) throw error;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    execFileSync('npx', ['drizzle-kit', 'migrate'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit', timeout: 60_000,
    });
    vi.stubEnv('DATABASE_URL', url);
    database = await import('../../db/index.js');
    jobs = {
      ...(await import('../letter/transcription-job.js')),
      ...(await import('../letter/metadata-job.js')),
      ...(await import('../letter/entity-extraction-job.js')),
      ...(await import('../letter/extra-content-job.js')),
      ...(await import('../worker-state.js')),
    } as Jobs;
  }, 120_000);

  beforeEach(async () => {
    await verify`delete from letters where collection_id = ${collectionId}`;
    await verify`delete from collections where id = ${collectionId}`;
    await verify`insert into collections (id, collection_code) values (${collectionId}, 'Q192')`;
  });

  afterAll(async () => {
    await Promise.allSettled([
      database?.closeDatabase(), verify?.end({ timeout: 1 }), locker?.end({ timeout: 1 }),
    ]);
    try {
      if (container) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore', timeout: 15_000 });
    } finally {
      vi.unstubAllEnvs();
    }
  }, 20_000);

  async function insertLetter(overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    await verify`insert into letters ${verify({
      id, collection_id: collectionId, date_raw: id,
      type: 'L', type_sequence: 1, ...overrides,
    })}`;
    return id;
  }

  async function row(id: string) {
    const [result] = await verify`select * from letters where id = ${id}`;
    return result!;
  }

  // Both production pool sessions must be blocked on the row before it is
  // released. Promise.all alone can accidentally exercise only serial updates.
  async function withLockedRow<T>(id: string, work: () => Promise<T>): Promise<T> {
    let release!: () => void;
    let signalLocked!: () => void;
    const locked = new Promise<void>(resolve => { signalLocked = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const held = locker.begin(async tx => {
      await tx.unsafe('select id from letters where id = $1 for update', [id]);
      signalLocked();
      await released;
    });
    // Observe rejections immediately; all paths release and drain both sides.
    const lockOutcome = held.then(() => null, error => ({ error }));
    let outcome: Promise<{ value: T } | { error: unknown }> | undefined;
    try {
      await Promise.race([locked, lockOutcome.then(result => {
        throw result?.error ?? new Error('row lock ended before synchronization');
      })]);
      outcome = work().then(value => ({ value }), error => ({ error }));
      let overlapped = false;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const [activity] = await verify`
          select count(distinct pid)::int as count from pg_stat_activity
          where application_name = 'letter-archive' and wait_event_type = 'Lock'
            and query ilike 'update%letters%'
        `;
        if (activity!.count >= 2) { overlapped = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      release();
      const result = await outcome;
      if ('error' in result) throw result.error;
      expect(overlapped, 'two production sessions waited on the locked row').toBe(true);
      return result.value;
    } finally {
      release();
      await outcome;
      const result = await lockOutcome;
      if (result) throw result.error;
    }
  }

  const metadata: MetadataV2 = {
    sender: 'new sender', recipient: null, location_written: null,
    extracted_date: null, hook: null, summary: 'new summary', emotional_tone: null,
    sender_recipient_relationship: null, primary_topics: [], notable_quotes: [], ai_notes: [],
  };
  const metadataSource = {
    transcription_status: 'SUCCESS', transcription_text: 'confirmed source',
    transcript_confirmed_at: new Date(), workflow: 'TRANSCRIBED',
    sender: 'committed sender', metadata_content_status: 'AI_DRAFT',
  };
  const extraResult = {
    value: 'new extra', patch: {
      extraContentTranscript: 'new extra', extraContentStatus: 'AI_DRAFT' as const,
      extraContentVerifiedAt: null, extraContentVerifiedBy: null,
    },
  };

  function expectCleared(source: Row, prefix: string, revisionBound = false) {
    for (const suffix of ['run_id', 'lease_run_id', 'lease_expires_at', 'claim_kind']) {
      expect(source[`${prefix}_${suffix}`], `${prefix}_${suffix}`).toBeNull();
    }
    if (revisionBound) expect(source[`${prefix}_run_revision`]).toBeNull();
    if (prefix === 'extra_content_job') expect(source.extra_content_job_dirty).toBe(false);
  }

  async function expectDatabaseDeadline(id: string, prefix: string) {
    const [result] = await verify`
      select extract(epoch from (${verify(`${prefix}_lease_expires_at`)} - clock_timestamp())) as seconds
      from letters where id = ${id}
    `;
    expect(Number(result!.seconds)).toBeGreaterThan(290);
    expect(Number(result!.seconds)).toBeLessThanOrEqual(300);
  }

  function transcriptionObserved(source: Row) {
    return jobs.observeTranscriptionState({
      primarySourceRevision: source.primary_source_revision,
      transcriptionStatus: source.transcription_status, workflow: source.workflow,
      transcriptionText: source.transcription_text, transcriptionError: source.transcription_error,
      transcriptionAttemptCount: source.transcription_attempt_count,
      transcriptionLeaseExpiresAt: source.transcription_lease_expires_at,
      transcriptionLeaseRunId: source.transcription_lease_run_id,
      transcriptionClaimKind: source.transcription_claim_kind,
      metadataStatus: source.metadata_status, entityExtractionStatus: source.entity_extraction_status,
      deadLetter: source.dead_letter, transcriptStatus: source.transcript_status,
    });
  }

  function metadataObserved(source: Row) {
    return jobs.observeMetadataState({
      type: source.type, workflow: source.workflow, transcriptionStatus: source.transcription_status,
      transcriptionText: source.transcription_text, transcriptConfirmedAt: source.transcript_confirmed_at,
      extraContentTranscript: source.extra_content_transcript, extraContentJobStatus: source.extra_content_job_status,
      extraContentJobRunId: source.extra_content_job_run_id, metadataStatus: source.metadata_status,
      metadataRevision: source.metadata_revision, metadataRunId: source.metadata_run_id,
      metadataRunRevision: source.metadata_run_revision, metadataLeaseExpiresAt: source.metadata_lease_expires_at,
      metadataLeaseRunId: source.metadata_lease_run_id, metadataClaimKind: source.metadata_claim_kind,
      metadataContentStatus: source.metadata_content_status, metadataVerifiedAt: source.metadata_verified_at,
      metadataVerifiedBy: source.metadata_verified_by, entityExtractionStatus: source.entity_extraction_status,
      deadLetter: source.dead_letter,
    });
  }

  function entityObserved(source: Row) {
    return jobs.observeEntityExtractionState({
      type: source.type, transcriptionStatus: source.transcription_status,
      metadataStatus: source.metadata_status, extraContentJobStatus: source.extra_content_job_status,
      entityExtractionStatus: source.entity_extraction_status, entityExtractionRevision: source.entity_extraction_revision,
      entityExtractionRunId: source.entity_extraction_run_id,
      entityExtractionRunRevision: source.entity_extraction_run_revision,
      entityExtractionLeaseExpiresAt: source.entity_extraction_lease_expires_at,
      entityExtractionLeaseRunId: source.entity_extraction_lease_run_id,
      entityExtractionClaimKind: source.entity_extraction_claim_kind, deadLetter: source.dead_letter,
    });
  }

  it('runs four production claims concurrently on separate PostgreSQL sessions', async () => {
    const transcriptionId = await insertLetter();
    const metadataId = await insertLetter(metadataSource);
    const entityId = await insertLetter({ transcription_status: 'SUCCESS', metadata_status: 'SUCCESS' });
    const extraId = await insertLetter();
    const cases: Array<[string, string, (source: Row) => Promise<unknown>]> = [
      [transcriptionId, 'transcription', source => jobs.claimQueuedTranscription(transcriptionId, transcriptionObserved(source))],
      [metadataId, 'metadata', source => jobs.claimQueuedMetadata(metadataId, metadataObserved(source))],
      [entityId, 'entity_extraction', source => jobs.claimQueuedEntityExtraction(entityId, entityObserved(source))],
    ];
    for (const [id, prefix, invoke] of cases) {
      const source = await row(id);
      const results = await withLockedRow(id, () => Promise.all([invoke(source), invoke(source)]));
      expect(results.filter(Boolean)).toHaveLength(1);
      const claimed = await row(id);
      expect(claimed[`${prefix}_status`]).toBe('RUNNING');
      expect(claimed[`${prefix}_lease_run_id`]).toBe(claimed[`${prefix}_run_id`]);
      await expectDatabaseDeadline(id, prefix);
    }
    const source = await row(extraId);
    let producers = 0;
    const invoke = () => jobs.runExtraContentJob({
      letterId: extraId, expectedPrimarySourceRevision: source.primary_source_revision,
      expectedStatus: source.extra_content_job_status, expectedUpdatedAt: source.updated_at,
      claimKind: 'QUEUED', produce: async () => {
        producers += 1;
        await expectDatabaseDeadline(extraId, 'extra_content_job');
        return { value: 'ok', patch: { extraContentTranscript: 'extra', extraContentStatus: 'AI_DRAFT', extraContentVerifiedAt: null, extraContentVerifiedBy: null } };
      },
    });
    const results = await withLockedRow(extraId, () => Promise.all([invoke(), invoke()]));
    expect(results.map(result => result.kind).sort()).toEqual(['claim_lost', 'completed']);
    expect(producers).toBe(1);
    expectCleared(await row(extraId), 'extra_content_job');
  });

  it('uses the PostgreSQL clock for claim deadlines even when the application clock is wrong', async () => {
    const id = await insertLetter();
    const source = await row(id);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));
    try {
      const claim = await jobs.claimQueuedTranscription(id, transcriptionObserved(source));
      expect(claim).not.toBeNull();
      await expectDatabaseDeadline(id, 'transcription');
      await expect(jobs.renewTranscriptionLease(id, claim!.runId)).resolves.toBe(true);
      await expectDatabaseDeadline(id, 'transcription');
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves all three live leases when recovery runs before their deadlines', async () => {
    const transcriptionId = await insertLetter();
    const metadataId = await insertLetter(metadataSource);
    expect(await jobs.claimQueuedTranscription(transcriptionId, transcriptionObserved(await row(transcriptionId)))).not.toBeNull();
    expect(await jobs.claimQueuedMetadata(metadataId, metadataObserved(await row(metadataId)))).not.toBeNull();
    const transcription = await row(transcriptionId);
    const metadata = await row(metadataId);
    const id = await insertLetter();
    const source = await row(id);
    const result = await jobs.runExtraContentJob({
      letterId: id, expectedPrimarySourceRevision: source.primary_source_revision,
      expectedStatus: source.extra_content_job_status, expectedUpdatedAt: source.updated_at,
      claimKind: 'QUEUED', produce: async () => {
        const extra = await row(id);
        const recovered = await Promise.all([
          jobs.recoverExpiredTranscriptions(), jobs.recoverExpiredMetadataJobs(), jobs.recoverExpiredExtraContentJobs(),
        ]);
        for (const recovery of recovered) expect(recovery).toEqual({ requeued: [], failed: [] });
        expect(await row(transcriptionId)).toEqual(transcription);
        expect(await row(metadataId)).toEqual(metadata);
        expect(await row(id)).toEqual(extra);
        return extraResult;
      },
    });
    expect(result.kind).toBe('completed');
  });

  it('fences a stale transcription completion by primary source revision', async () => {
    const id = await insertLetter();
    const source = await row(id);
    const claim = await jobs.claimQueuedTranscription(id, transcriptionObserved(source));
    expect(claim).not.toBeNull();
    await verify`update letters set primary_source_revision = primary_source_revision + 1 where id = ${id}`;
    await expect(jobs.completeTranscription(id, claim!.runId, 'stale', source.primary_source_revision)).resolves.toBe(false);
    const final = await row(id);
    expect(final.primary_source_revision).toBe(source.primary_source_revision + 1);
    expect(final.transcription_text).toBeNull();
    expect(final.transcription_status).toBe('RUNNING');
  });

  it('requeues a stale extra-content producer instead of publishing across a source revision', async () => {
    const id = await insertLetter();
    const source = await row(id);
    const result = await jobs.runExtraContentJob({
      letterId: id, expectedPrimarySourceRevision: source.primary_source_revision,
      expectedStatus: source.extra_content_job_status, expectedUpdatedAt: source.updated_at,
      claimKind: 'QUEUED', produce: async () => {
        await verify`update letters set primary_source_revision = primary_source_revision + 1 where id = ${id}`;
        return { value: 'stale', patch: { extraContentTranscript: 'stale', extraContentStatus: 'AI_DRAFT', extraContentVerifiedAt: null, extraContentVerifiedBy: null } };
      },
    });
    expect(result).toEqual({ kind: 'superseded' });
    const final = await row(id);
    expect(final.primary_source_revision).toBe(source.primary_source_revision + 1);
    expect(final.extra_content_transcript).toBeNull();
    expect(final.extra_content_job_status).toBe('PENDING');
    expectCleared(final, 'extra_content_job');
  });

  it('rejects transcription writes from the wrong owner and accepts the current owner', async () => {
    const id = await insertLetter();
    const source = await row(id);
    const claim = await jobs.claimQueuedTranscription(id, transcriptionObserved(source));
    expect(claim).not.toBeNull();
    const owned = await row(id);
    await expect(jobs.completeTranscription(id, randomUUID(), 'stale', source.primary_source_revision)).resolves.toBe(false);
    expect(await row(id)).toEqual(owned);
    await expect(jobs.completeTranscription(id, claim!.runId, 'current', source.primary_source_revision)).resolves.toBe(true);
    const final = await row(id);
    expect(final.transcription_text).toBe('current');
    expect(final.transcription_status).toBe('SUCCESS');
    expectCleared(final, 'transcription');
  });

  it('fences metadata owner, revision, and superseded source before publishing the current result', async () => {
    const id = await insertLetter(metadataSource);
    const source = await row(id);
    const claim = await jobs.claimQueuedMetadata(id, metadataObserved(source));
    expect(claim).not.toBeNull();
    const owned = await row(id);
    await expect(jobs.completeMetadata(id, { ...claim!, runId: randomUUID() }, metadata)).resolves.toBe(false);
    await expect(jobs.completeMetadata(id, { ...claim!, revision: claim!.revision + 1 }, metadata)).resolves.toBe(false);
    expect(await row(id)).toEqual(owned);
    // This is the same production invalidation patch used by source writers.
    await database.db.update(database.letters).set({
      transcriptionText: 'replacement source', ...jobs.buildMetadataSourceInvalidationPatch(),
    }).where(eq(database.letters.id, id));
    const invalidated = await row(id);
    expect(invalidated.metadata_revision).toBe(claim!.revision + 1);
    expectCleared(invalidated, 'metadata', true);
    await expect(jobs.completeMetadata(id, claim!, metadata)).resolves.toBe(false);
    expect(await row(id)).toEqual(invalidated);
    const successor = await jobs.claimQueuedMetadata(id, metadataObserved(invalidated));
    expect(successor).not.toBeNull();
    await expect(jobs.completeMetadata(id, claim!, metadata)).resolves.toBe(false);
    await expect(jobs.completeMetadata(id, successor!, metadata)).resolves.toBe(true);
    const final = await row(id);
    expect(final.sender).toBe(metadata.sender);
    expect(final.metadata_status).toBe('SUCCESS');
    expectCleared(final, 'metadata', true);
  });

  it('keeps a live extra-content successor owned when its cancelled predecessor finishes', async () => {
    const id = await insertLetter({ extra_content_transcript: 'committed extra' });
    const source = await row(id);
    let release!: () => void;
    let started!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    let successorOutcome: Promise<{ kind: string } | { error: unknown }> | undefined;
    let successorRow: Row | undefined;
    let cancelled = false;
    try {
      const result = await jobs.runExtraContentJob({
        letterId: id, expectedPrimarySourceRevision: source.primary_source_revision,
        expectedStatus: source.extra_content_job_status, expectedUpdatedAt: source.updated_at,
        claimKind: 'REQUESTED', produce: async () => {
          const owner = await row(id);
          cancelled = await jobs.cancelExtraContentAttempt(id, owner.extra_content_job_run_id);
          const afterCancel = await row(id);
          successorOutcome = jobs.runExtraContentJob({
            letterId: id, expectedPrimarySourceRevision: afterCancel.primary_source_revision,
            expectedStatus: afterCancel.extra_content_job_status, expectedUpdatedAt: afterCancel.updated_at,
            claimKind: 'REQUESTED', produce: async () => {
              successorRow = await row(id);
              started();
              await released;
              return extraResult;
            },
          }).catch(error => ({ error }));
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              ready,
              successorOutcome.then(() => { throw new Error('successor did not reach its producer'); }),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('successor producer timed out')), 3_000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
          return { ...extraResult, patch: { ...extraResult.patch, extraContentTranscript: 'late extra' } };
        },
      });
      expect(cancelled).toBe(true);
      expect(result.kind).toBe('superseded');
      expect(successorRow?.extra_content_job_status).toBe('RUNNING');
      expect(await row(id)).toEqual(successorRow);
    } finally {
      release();
      if (successorOutcome) expect(await successorOutcome).toMatchObject({ kind: 'completed' });
    }
    const final = await row(id);
    expect(final.extra_content_transcript).toBe('new extra');
    expectCleared(final, 'extra_content_job');
  });

  it.each(['QUEUED', 'REQUESTED'] as const)('recovers expired %s transcription once and fences late writes', async kind => {
    const id = await insertLetter({ transcription_text: 'committed transcript' });
    const source = await row(id);
    const claim = kind === 'QUEUED'
      ? await jobs.claimQueuedTranscription(id, transcriptionObserved(source))
      : await jobs.claimRequestedTranscription(id, transcriptionObserved(source));
    expect(claim).not.toBeNull();
    await verify`update letters set transcription_lease_expires_at = clock_timestamp() - interval '1 second' where id = ${id}`;
    await expect(jobs.completeTranscription(id, claim!.runId, 'late', source.primary_source_revision)).resolves.toBe(false);
    const recovered = await withLockedRow(id, () => Promise.all([
      jobs.recoverExpiredTranscriptions(), jobs.recoverExpiredTranscriptions(),
    ]));
    expect(recovered.flatMap(result => result.requeued).map(result => result.id)).toEqual(kind === 'QUEUED' ? [id] : []);
    expect(recovered.flatMap(result => result.failed).map(result => result.id)).toEqual(kind === 'REQUESTED' ? [id] : []);
    const final = await row(id);
    expect(final.transcription_status).toBe(kind === 'QUEUED' ? 'PENDING' : 'FAILED');
    expect(final.transcription_text).toBe('committed transcript');
    expect(final.workflow).toBe('UPLOADED');
    expectCleared(final, 'transcription');
    await expect(jobs.completeTranscription(id, claim!.runId, 'late', source.primary_source_revision)).resolves.toBe(false);
    expect(await row(id)).toEqual(final);
    const successor = await jobs.claimRequestedTranscription(id, transcriptionObserved(final));
    expect(successor).not.toBeNull();
    await expect(jobs.completeTranscription(id, claim!.runId, 'late', source.primary_source_revision)).resolves.toBe(false);
    await expect(jobs.completeTranscription(id, successor!.runId, 'successor', source.primary_source_revision)).resolves.toBe(true);
  });

  it.each(['QUEUED', 'REQUESTED'] as const)('recovers expired %s metadata once and fences late writes', async kind => {
    const id = await insertLetter(metadataSource);
    const source = await row(id);
    const claim = kind === 'QUEUED'
      ? await jobs.claimQueuedMetadata(id, metadataObserved(source))
      : await jobs.claimRequestedMetadata(id, metadataObserved(source), source.primary_source_revision);
    expect(claim).not.toBeNull();
    await verify`update letters set metadata_lease_expires_at = clock_timestamp() - interval '1 second' where id = ${id}`;
    await expect(jobs.completeMetadata(id, claim!, metadata)).resolves.toBe(false);
    const recovered = await withLockedRow(id, () => Promise.all([
      jobs.recoverExpiredMetadataJobs(), jobs.recoverExpiredMetadataJobs(),
    ]));
    expect(recovered.flatMap(result => result.requeued).map(result => result.id)).toEqual(kind === 'QUEUED' ? [id] : []);
    expect(recovered.flatMap(result => result.failed).map(result => result.id)).toEqual(kind === 'REQUESTED' ? [id] : []);
    const final = await row(id);
    expect(final.metadata_status).toBe(kind === 'QUEUED' ? 'PENDING' : 'FAILED');
    expect(final.metadata_revision).toBe(claim!.revision + 1);
    expect(final.workflow).toBe(kind === 'QUEUED' ? 'TRANSCRIBED' : 'METADATA_DRAFTED');
    expect(final.sender).toBe('committed sender');
    expectCleared(final, 'metadata', true);
    await expect(jobs.completeMetadata(id, claim!, metadata)).resolves.toBe(false);
    expect(await row(id)).toEqual(final);
    const successor = await jobs.claimRequestedMetadata(id, metadataObserved(final), final.primary_source_revision);
    expect(successor).not.toBeNull();
    await expect(jobs.completeMetadata(id, claim!, metadata)).resolves.toBe(false);
    await expect(jobs.completeMetadata(id, successor!, metadata)).resolves.toBe(true);
  });

  it.each(['QUEUED', 'REQUESTED'] as const)('recovers expired %s extra-content once while its producer is still running', async kind => {
    const id = await insertLetter({ extra_content_transcript: 'committed extra' });
    const source = await row(id);
    const result = await jobs.runExtraContentJob({
      letterId: id, expectedPrimarySourceRevision: source.primary_source_revision,
      expectedStatus: source.extra_content_job_status, expectedUpdatedAt: source.updated_at,
      claimKind: kind, produce: async () => {
        await verify`update letters set extra_content_job_lease_expires_at = clock_timestamp() - interval '1 second' where id = ${id}`;
        const recovered = await withLockedRow(id, () => Promise.all([
          jobs.recoverExpiredExtraContentJobs(), jobs.recoverExpiredExtraContentJobs(),
        ]));
        expect(recovered.flatMap(value => value.requeued).map(value => value.id)).toEqual(kind === 'QUEUED' ? [id] : []);
        expect(recovered.flatMap(value => value.failed).map(value => value.id)).toEqual(kind === 'REQUESTED' ? [id] : []);
        const recoveredRow = await row(id);
        expect(recoveredRow.extra_content_job_status).toBe(kind === 'QUEUED' ? 'PENDING' : 'FAILED');
        expect(recoveredRow.extra_content_transcript).toBe('committed extra');
        expectCleared(recoveredRow, 'extra_content_job');
        // Publish a replacement before letting the old producer finish. Its
        // late terminal write must preserve this successor's content and state.
        const replacement = await jobs.runExtraContentJob({
          letterId: id, expectedPrimarySourceRevision: recoveredRow.primary_source_revision,
          expectedStatus: recoveredRow.extra_content_job_status, expectedUpdatedAt: recoveredRow.updated_at,
          claimKind: 'REQUESTED', produce: async () => extraResult,
        });
        expect(replacement.kind).toBe('completed');
        return { ...extraResult, patch: { ...extraResult.patch, extraContentTranscript: 'late extra' } };
      },
    });
    expect(result.kind).toBe('superseded');
    const final = await row(id);
    expect(final.extra_content_job_status).toBe('SUCCESS');
    expect(final.extra_content_transcript).toBe('new extra');
    expectCleared(final, 'extra_content_job');
  });

  it('uses the production worker-state functions to keep an expired owner from releasing its successor', async () => {
    const [first, second] = await Promise.all([jobs.acquireWorkerExecutionLease(), jobs.acquireWorkerExecutionLease()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const owner = (first ?? second)!;
    await verify`update worker_state set execution_lease_expires_at = clock_timestamp() - interval '1 second' where id = 'singleton'`;
    const successor = await jobs.acquireWorkerExecutionLease();
    expect(successor).not.toBeNull();
    await expect(jobs.releaseWorkerExecutionLease(owner.token)).resolves.toBe(false);
    await expect(jobs.releaseWorkerExecutionLease(successor!.token)).resolves.toBe(true);
  });
});
