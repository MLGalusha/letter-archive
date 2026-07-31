import { describe, expect, it } from 'vitest';
import {
  geometryChangeSummary,
  normalizeLineSegments,
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
  validateGeometryProvenanceTransition,
} from '../page-geometry.js';

const detected = {
  id: 'line-1',
  line: 1,
  geometryType: 'baseline' as const,
  baseline: [[1, 2], [3, 4]] as [number, number][],
  bbox: [1, 2, 3, 4] as [number, number, number, number],
  ocrText: 'rough OCR',
};

describe('page geometry identity', () => {
  it('normalizes old detector records to explicit machine provenance', () => {
    expect(normalizeLineSegments([detected])[0].geometryProvenance).toEqual({
      source: 'machine',
      operation: 'detected',
      parentSegmentIds: [],
    });
  });

  it('ignores transcript mapping and semantic review metadata', () => {
    const reviewed = {
      ...detected,
      ocrText: 'different OCR',
      isMapped: true,
      mappedText: 'Authoritative text',
      excluded: true,
      segmentClass: 'ignore' as const,
    };
    expect(pageGeometryChecksum([reviewed])).toBe(
      pageGeometryChecksum([detected]),
    );
    expect(pageLineSegmentsChecksum([reviewed])).not.toBe(
      pageLineSegmentsChecksum([detected]),
    );
  });

  it('canonicalizes the complete projection independently of object key order', () => {
    const reorderedKeys = {
      ocrText: detected.ocrText,
      bbox: detected.bbox,
      baseline: detected.baseline,
      geometryType: detected.geometryType,
      line: detected.line,
      id: detected.id,
    };

    expect(pageLineSegmentsChecksum([reorderedKeys])).toBe(
      pageLineSegmentsChecksum([detected]),
    );
  });

  it('changes identity for shape/provenance edits and records deletion lineage', () => {
    const adjusted = {
      ...detected,
      bbox: [2, 2, 4, 4] as [number, number, number, number],
      geometryProvenance: {
        source: 'human-adjusted' as const,
        operation: 'move' as const,
        parentSegmentIds: ['line-1'],
      },
    };
    expect(pageGeometryChecksum([adjusted])).not.toBe(
      pageGeometryChecksum([detected]),
    );
    expect(geometryChangeSummary([detected], [])).toEqual({
      created: [],
      updated: [],
      deleted: [{
        segmentId: 'line-1',
        provenance: {
          source: 'human-adjusted',
          operation: 'delete',
          parentSegmentIds: ['line-1'],
        },
      }],
      reordered: [],
    });
  });

  it('gives legacy records a deterministic stable identity across a round-trip', () => {
    const legacy = { ...detected, id: undefined };
    const firstRead = normalizeLineSegments([legacy]);
    const secondRead = normalizeLineSegments(firstRead);

    expect(firstRead[0].id).toBe('legacy:0:1');
    expect(secondRead).toEqual(firstRead);
    expect(pageGeometryChecksum(secondRead)).toBe(
      pageGeometryChecksum(firstRead),
    );
    expect(validateGeometryProvenanceTransition(firstRead, secondRead))
      .toEqual([]);
  });

  it('rejects forged machine provenance for a new or changed outline', () => {
    const previous = normalizeLineSegments([detected]);
    const forgedNew = normalizeLineSegments([{
      ...detected,
      id: 'forged-new',
    }]);
    const forgedEdit = normalizeLineSegments([{
      ...detected,
      bbox: [2, 2, 4, 4],
    }]);

    expect(validateGeometryProvenanceTransition(previous, forgedNew)[0])
      .toMatch(/must be human-created/);
    expect(validateGeometryProvenanceTransition(previous, forgedEdit)[0])
      .toMatch(/must be human-adjusted/);
  });

  it('allows ordinal changes without falsely relabeling unchanged outlines', () => {
    const second = {
      ...detected,
      id: 'line-2',
      line: 2,
      bbox: [1, 5, 3, 7] as [number, number, number, number],
      baseline: [[1, 5], [3, 7]] as [number, number][],
    };
    const previous = normalizeLineSegments([detected, second]);
    const reordered = [
      { ...previous[1], line: 1 },
      { ...previous[0], line: 2 },
    ];

    expect(validateGeometryProvenanceTransition(previous, reordered))
      .toEqual([]);
    expect(geometryChangeSummary(previous, reordered)).toMatchObject({
      created: [],
      updated: [],
      deleted: [],
      reordered: [
        { segmentId: 'line-2', fromLine: 2, toLine: 1 },
        { segmentId: 'line-1', fromLine: 1, toLine: 2 },
      ],
    });
  });

  it('rejects provenance rewrites when the shape did not change', () => {
    const previous = normalizeLineSegments([detected]);
    const relabeled = [{
      ...previous[0],
      geometryProvenance: {
        source: 'human-adjusted' as const,
        operation: 'move' as const,
        parentSegmentIds: ['line-1'],
      },
    }];

    expect(validateGeometryProvenanceTransition(previous, relabeled)[0])
      .toMatch(/cannot rewrite geometry provenance/);
  });
});
