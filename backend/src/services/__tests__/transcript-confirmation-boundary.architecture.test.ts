import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');

const paths = {
  route: path.join(
    repoRoot,
    'backend/src/routes/admin/letters/content.ts',
  ),
  service: path.join(
    repoRoot,
    'backend/src/services/letter/transcript-confirmation.ts',
  ),
  migration: path.join(
    repoRoot,
    'backend/src/db/migrations/0055_add_transcript_confirmation_intent.sql',
  ),
};

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('transcript confirmation execution boundary', () => {
  it('keeps confirmation transactional and worker-owned across rollout', async () => {
    const [route, service, migration] = await Promise.all(
      Object.values(paths).map(file => readFile(file, 'utf8')),
    );
    const confirmationRoute = between(
      route,
      "router.post('/:letterId/confirm-transcript'",
      "router.post('/:letterId/regenerate-metadata'",
    );

    expect(route).toMatch(
      /import \{ confirmTranscriptIntent \} from ['"].*transcript-confirmation\.js['"]/,
    );
    expect(confirmationRoute).toContain('confirmTranscriptIntent({');
    expect(confirmationRoute).toContain(
      "requestBackgroundWorkerRun('transcript-confirmation')",
    );
    expect(confirmationRoute).not.toContain('runMetadataExtractionV2(');
    expect(confirmationRoute).not.toContain(
      'claimMetadataAfterTranscriptConfirmation',
    );
    expect(route).not.toContain('claimMetadataAfterTranscriptConfirmation');

    expect(service).toContain('return database.transaction(async (tx) =>');
    expect(service).toContain(".for('update')");
    expect(service).not.toContain('runMetadataExtractionV2(');

    const workerGate = migration.match(
      /ADD CONSTRAINT "metadata_guidance_running_bound_to_run"([\s\S]*?)NOT VALID;/,
    )?.[1];
    expect(workerGate).toBeDefined();
    expect(workerGate).toMatch(
      /"metadata_confirmation_guidance" IS NULL[\s\S]*"metadata_status" <> 'RUNNING'[\s\S]*"metadata_guidance_run_id" IS NOT NULL[\s\S]*"metadata_run_id" IS NOT NULL[\s\S]*"metadata_guidance_run_id" = "metadata_run_id"/,
    );
  });
});
