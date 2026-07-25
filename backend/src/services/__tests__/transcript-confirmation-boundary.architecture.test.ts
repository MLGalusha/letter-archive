import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');

const paths = {
  route: path.join(
    repoRoot,
    'backend/src/routes/admin/letters/content.ts',
  ),
  api: path.join(repoRoot, 'frontend/src/api/admin/letters.ts'),
  dashboard: path.join(
    repoRoot,
    'frontend/src/pages/admin/AdminDashboard/useDashboardProcessingActions.ts',
  ),
  outcomeMap: path.join(
    repoRoot,
    'docs/architecture-cleanup/transcript-confirmation-outcomes.md',
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
  it('keeps the current unsafe boundary visible until behavior tests replace it', async () => {
    const [
      route,
      api,
      dashboard,
      outcomeMap,
    ] = await Promise.all(Object.values(paths).map(file => readFile(file, 'utf8')));
    const confirmationRoute = between(
      route,
      "router.post('/:letterId/confirm-transcript'",
      "router.post('/:letterId/regenerate-metadata'",
    );
    const confirmationApi = between(
      api,
      'export async function confirmTranscript',
      'export async function regenerateMetadata',
    );
    const runsMetadataSynchronously = confirmationRoute.includes(
      'runMetadataExtractionV2(',
    );

    // This is deliberately a temporary characterization tripwire, not proof
    // of the future async architecture. The behavior-changing slice must
    // replace it with executable service/route/worker/frontend contracts.
    expect(runsMetadataSynchronously).toBe(true);
    expect(confirmationRoute).toContain(
      'claimMetadataAfterTranscriptConfirmation(',
    );
    expect(confirmationApi).toContain('return apiPost<Letter>');
    expect(confirmationApi).not.toContain('timeoutMs');
    expect(dashboard).toContain(
      'updatedLetter.metadataContentStatus === "EMPTY"',
    );
    expect(outcomeMap).toMatch(/The HTTP request performs no AI\b/);
  });
});
