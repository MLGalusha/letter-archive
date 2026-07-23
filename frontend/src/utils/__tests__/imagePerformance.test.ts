import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ImagePerformanceModule = typeof import('../imagePerformance');

let imagePerformance: ImagePerformanceModule;
let sendBeaconMock: ReturnType<typeof vi.fn>;
const originalSendBeacon = Object.getOwnPropertyDescriptor(navigator, 'sendBeacon');

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

async function readBeaconPayload(callIndex: number) {
  const blob = sendBeaconMock.mock.calls[callIndex]?.[1] as Blob;
  return JSON.parse(await readBlob(blob)) as Array<{
    url: string;
    context: string;
    durationMs: number;
  }>;
}

describe('image performance telemetry', () => {
  beforeEach(async () => {
    vi.resetModules();
    sendBeaconMock = vi.fn();
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: sendBeaconMock,
    });
    imagePerformance = await import('../imagePerformance');
  });

  afterEach(() => {
    if (originalSendBeacon) {
      Object.defineProperty(navigator, 'sendBeacon', originalSendBeacon);
    } else {
      Reflect.deleteProperty(navigator, 'sendBeacon');
    }
  });

  it('removes query strings and fragments from image URLs', () => {
    expect(
      imagePerformance.sanitizeImageTelemetryUrl(
        'http://localhost:3002/images/page-1?token=reusable-admin-jwt&w=640#preview',
      ),
    ).toBe('http://localhost:3002/images/page-1');
  });

  it('never retains image credentials in the telemetry buffer', () => {
    imagePerformance.recordImageLoad({
      url: '/images/page-hidden?token=reusable-admin-jwt&w=640',
      tier: 'mid',
      context: 'admin-review',
      durationMs: 42,
      cached: false,
    });

    expect(imagePerformance.getRecentEntries(1)[0]).toMatchObject({
      url: '/images/page-hidden',
      tier: 'mid',
      context: 'admin-review',
    });
  });

  it('builds a bounded payload that satisfies the server contract', () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      url: `/images/page-${index}?ToKeN=reusable-admin-jwt&w=640`,
      tier: 'mid' as const,
      context: index === 19 ? ' '.repeat(70) : 'letter-viewer',
      durationMs: index === 19 ? Number.POSITIVE_INFINITY : 42,
      cached: false,
      timestamp: index,
    }));

    const payload = JSON.parse(imagePerformance.buildImagePerfPayload(entries)) as Array<{
      url: string;
      context: string;
      durationMs: number;
    }>;

    expect(payload).toHaveLength(20);
    expect(payload[0].url).toBe('/images/page-0');
    expect(payload.at(-1)).toMatchObject({
      url: '/images/page-19',
      context: 'unknown',
      durationMs: 0,
    });
  });

  it('keeps a bounded pending queue and flushes its oldest batches first', async () => {
    for (let index = 0; index < 205; index++) {
      imagePerformance.recordImageLoad({
        url: `/images/page-${index}?w=640`,
        tier: 'mid',
        context: 'archive',
        durationMs: index,
        cached: false,
      });
    }
    sendBeaconMock.mockReturnValue(true);

    expect(imagePerformance.getRecentEntries(200)).toHaveLength(200);
    expect(imagePerformance.getRecentEntries(200)[0]?.url).toBe('/images/page-5');
    expect(imagePerformance.getRecentEntries(1)[0]?.url).toBe('/images/page-204');

    expect(imagePerformance.flushImagePerfTelemetry()).toBe(true);
    expect(imagePerformance.flushImagePerfTelemetry()).toBe(true);

    const firstBatch = await readBeaconPayload(0);
    const secondBatch = await readBeaconPayload(1);
    expect(firstBatch).toHaveLength(20);
    expect(firstBatch[0]?.url).toBe('/images/page-5');
    expect(firstBatch.at(-1)?.url).toBe('/images/page-24');
    expect(secondBatch[0]?.url).toBe('/images/page-25');
    expect(secondBatch.at(-1)?.url).toBe('/images/page-44');
  });

  it('retains a rejected beacon batch and retries it unchanged', async () => {
    imagePerformance.recordImageLoad({
      url: '/images/retry-me?w=640',
      tier: 'mid',
      context: 'letter-viewer',
      durationMs: 42,
      cached: false,
    });
    sendBeaconMock
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    expect(imagePerformance.flushImagePerfTelemetry()).toBe(false);
    expect(imagePerformance.flushImagePerfTelemetry()).toBe(true);
    expect(imagePerformance.flushImagePerfTelemetry()).toBe(false);
    expect(sendBeaconMock).toHaveBeenCalledTimes(2);

    expect(await readBeaconPayload(0)).toEqual(await readBeaconPayload(1));
  });
});
