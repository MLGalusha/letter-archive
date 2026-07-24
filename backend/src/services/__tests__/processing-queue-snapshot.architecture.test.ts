import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const sourceRoot = new URL('../../', import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, sourceRoot), 'utf8');
}

function exportedFunction(contents: string, name: string): string {
  const start = contents.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`Could not find ${name}`);
  const next = contents.indexOf('\nexport async function ', start + 1);
  return contents.slice(start, next === -1 ? contents.length : next);
}

describe('processing queue snapshot ownership', () => {
  it('requires the same source-and-token schema on every single-row control', async () => {
    const route = await source('routes/admin/letters/processing.ts');

    expect(route.match(/processingJobActionSchema\.parse\(req\.body\)/g))
      .toHaveLength(3);
    for (const mutation of [
      'cancelActiveJob',
      'removeFromQueue',
      'retryJob',
    ]) {
      expect(route).toMatch(new RegExp(
        `${mutation}\\(letterId, type, \\{[\\s\\S]*?primarySourceRevision,[\\s\\S]*?jobStateToken`,
      ));
    }
  });

  it('keeps clear bounded to the displayed snapshots', async () => {
    const [route, service] = await Promise.all([
      source('routes/admin/letters/processing.ts'),
      source('services/processing-queue.ts'),
    ]);
    const clear = exportedFunction(service, 'clearQueue');

    expect(route).toContain('clearProcessingQueueSnapshotSchema.parse(req.body)');
    expect(route).toContain('clearQueue(type, items)');
    expect(clear).toContain('for (const snapshot of snapshots)');
    expect(clear).toContain('transitionQueuedJob(');
    expect(clear).not.toContain('findMany');
    expect(clear).not.toContain('inArray');
  });

  it('preserves source CAS inside every canonical active-run cancellation', async () => {
    const lifecycleSources = await Promise.all([
      source('services/letter/transcription-job.ts'),
      source('services/letter/metadata-job.ts'),
      source('services/letter/entity-extraction-job.ts'),
      source('services/letter/extra-content-job.ts'),
    ]);

    for (const contents of lifecycleSources) {
      expect(contents).toContain('expectedPrimarySourceRevision');
      expect(contents).toContain('letters.primarySourceRevision');
    }
  });
});
