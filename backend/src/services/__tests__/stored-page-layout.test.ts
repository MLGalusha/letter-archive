import { describe, expect, it } from 'vitest';
import {
  pageLayoutV2Schema,
  type PageLayoutV2,
} from '../../schemas/page-layout-v2.js';
import { pageLayoutChecksum } from '../page-layout-checksum.js';
import { validateStoredPageLayout } from '../stored-page-layout.js';

const checksum = (character: string) => character.repeat(64);

function layout(): PageLayoutV2 {
  return pageLayoutV2Schema.parse({
    schemaVersion: 2,
    layoutId: 'layout-page-1',
    runId: 'run-page-1',
    pageId: 'page-1',
    image: {
      width: 100,
      height: 200,
      checksumSha256: checksum('b'),
      coordinateSpace: {
        unit: 'pixel',
        origin: 'top-left',
        xAxis: 'right',
        yAxis: 'down',
      },
      source: {
        width: 100,
        height: 200,
        checksumSha256: checksum('a'),
        mode: 'RGB',
        exifOrientation: null,
      },
      normalization: {
        operation: 'none',
        applied: false,
        exifReadError: false,
      },
    },
    provenance: {
      producer: {
        name: 'kraken',
        version: '7.0.3',
        api: 'kraken.tasks.SegmentationTaskModel',
      },
      model: {
        name: 'default',
        version: '7.0.3',
        checksumSha256: checksum('c'),
      },
      config: {
        name: 'archive-default',
        version: '1',
        checksumSha256: checksum('d'),
      },
    },
    lineRepresentation: 'mixed',
    textDirection: 'horizontal-lr',
    scriptDetection: false,
    language: null,
    lines: [],
    regions: [],
    readingOrder: {
      primary: {
        id: 'order-primary',
        direction: 'unknown',
        source: 'provider',
        lineIds: [],
      },
      alternatives: [],
    },
  });
}

function storedRecord(
  overrides: Partial<Parameters<typeof validateStoredPageLayout>[0]> = {},
) {
  const value = layout();
  return {
    id: value.pageId,
    checksumSha256: checksum('a'),
    pageLayout: value,
    pageLayoutChecksumSha256: pageLayoutChecksum(value),
    ...overrides,
  };
}

describe('stored PageLayoutV2 validation', () => {
  it('treats the all-null layout pair as absent', () => {
    expect(validateStoredPageLayout(storedRecord({
      pageLayout: null,
      pageLayoutChecksumSha256: null,
    }))).toEqual({ status: 'absent' });
  });

  it.each([
    {
      pageLayout: null,
      pageLayoutChecksumSha256: checksum('e'),
    },
    {
      pageLayout: layout(),
      pageLayoutChecksumSha256: null,
    },
  ])('rejects a partially populated layout/checksum pair', (pair) => {
    expect(validateStoredPageLayout(storedRecord(pair))).toEqual({
      status: 'invalid',
      reason: 'layout document and checksum must both be present',
    });
  });

  it('rejects a stored document that fails the PageLayoutV2 schema', () => {
    expect(validateStoredPageLayout(storedRecord({
      pageLayout: {
        ...layout(),
        schemaVersion: 3,
      },
    }))).toEqual({
      status: 'invalid',
      reason: 'layout schema validation failed',
    });
  });

  it('rejects a malformed persisted digest', () => {
    expect(validateStoredPageLayout(storedRecord({
      pageLayoutChecksumSha256: 'not-a-sha256',
    }))).toEqual({
      status: 'invalid',
      reason: 'layout checksum format is invalid',
    });
  });

  it('rejects a layout whose page identity differs from its row', () => {
    expect(validateStoredPageLayout(storedRecord({
      id: 'page-2',
    }))).toEqual({
      status: 'invalid',
      reason: 'layout pageId does not match its row',
    });
  });

  it('rejects a layout bound to a different source image checksum', () => {
    expect(validateStoredPageLayout(storedRecord({
      checksumSha256: checksum('f'),
    }))).toEqual({
      status: 'invalid',
      reason: 'layout source checksum does not match its page source',
    });
  });

  it('rejects a valid-looking document whose persisted digest is stale', () => {
    expect(validateStoredPageLayout(storedRecord({
      pageLayoutChecksumSha256: checksum('f'),
    }))).toEqual({
      status: 'invalid',
      reason: 'layout integrity checksum mismatch',
    });
  });

  it('returns the parsed layout and verified digest when every binding matches', () => {
    const record = storedRecord();

    expect(validateStoredPageLayout(record)).toEqual({
      status: 'valid',
      layout: record.pageLayout,
      checksumSha256: record.pageLayoutChecksumSha256,
    });
  });
});
