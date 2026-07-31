import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { KrakenNativeWorker } from '../kraken-native-worker.js';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'kraken-native-worker.mjs',
);

const workers: KrakenNativeWorker[] = [];

async function startWorker() {
  const worker = await KrakenNativeWorker.start({
    executablePath: process.execPath,
    scriptPath: fixturePath,
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
    shutdownTimeoutMs: 2_000,
  });
  workers.push(worker);
  return worker;
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
});

describe('KrakenNativeWorker', () => {
  it('serializes concurrent calls through one long-lived process', async () => {
    const worker = await startWorker();

    const [first, second] = await Promise.all([
      worker.detect('/tmp/first.jpg'),
      worker.detect('/tmp/second.jpg', 'vertical-lr'),
    ]) as Array<Record<string, unknown>>;

    expect(first).toMatchObject({
      imagePath: '/tmp/first.jpg',
      textDirection: 'horizontal-lr',
      requestNumber: 1,
    });
    expect(first).not.toHaveProperty('rotationsDegrees');
    expect(second).toMatchObject({
      imagePath: '/tmp/second.jpg',
      textDirection: 'vertical-lr',
      requestNumber: 2,
    });
    expect(second.pid).toBe(first.pid);
  });

  it('writes the supported rotation profile only when explicitly requested', async () => {
    const worker = await startWorker();

    await expect(worker.detect(
      '/tmp/rotated.jpg',
      'horizontal-lr',
      [0, 90, 270],
    )).resolves.toMatchObject({
      imagePath: '/tmp/rotated.jpg',
      textDirection: 'horizontal-lr',
      rotationsDegrees: [0, 90, 270],
    });
  });

  it('keeps the worker usable after an isolated provider request error', async () => {
    const worker = await startWorker();

    await expect(worker.detect('fail')).rejects.toThrow(
      /FixtureError: deliberate request failure/,
    );
    await expect(worker.detect('/tmp/recovery.jpg')).resolves.toMatchObject({
      imagePath: '/tmp/recovery.jpg',
      requestNumber: 2,
    });
  });

  it('rejects instead of crashing the process when worker stdin breaks', async () => {
    const worker = await startWorker();

    await expect(worker.detect('close-stdin')).resolves.toMatchObject({
      imagePath: 'close-stdin',
    });
    await expect(worker.detect('/tmp/after-closed-stdin.jpg')).rejects.toThrow(
      /stdin (?:failed|is not writable)/,
    );
  });

  it('shuts down cleanly and rejects later work', async () => {
    const worker = await startWorker();
    await worker.close();

    await expect(worker.detect('/tmp/late.jpg')).rejects.toThrow(
      /no longer accepts requests/,
    );
  });
});
