import { describe, it, expect } from 'vitest';
import { attachWordsToSegments } from '../attachWordsToSegments';
import type { LineSegment, OcrWordBox } from '../../types/Letter';

function makeSeg(
  overrides: Partial<LineSegment> & { bbox: [number, number, number, number] },
): LineSegment {
  return {
    line: overrides.line ?? 1,
    baseline: overrides.baseline ?? [
      [overrides.bbox[0], overrides.bbox[3]],
      [overrides.bbox[2], overrides.bbox[3]],
    ],
    ocrText: overrides.ocrText ?? '',
    bbox: overrides.bbox,
  };
}

function makeWord(
  text: string,
  bbox: [number, number, number, number],
  confidence = 0.95,
): OcrWordBox {
  return { text, bbox, confidence };
}

describe('attachWordsToSegments', () => {
  it('assigns a word fully inside a segment to that segment', () => {
    const seg = makeSeg({ line: 1, bbox: [0, 0, 200, 50] });
    const word = makeWord('Hello', [10, 10, 60, 40]);

    const result = attachWordsToSegments([seg], [word]);

    expect(result.enriched).toHaveLength(1);
    expect(result.enriched[0].visionWords).toEqual([word]);
    expect(result.enriched[0].visionText).toBe('Hello');
    expect(result.unassigned).toHaveLength(0);
  });

  it('assigns a word to the segment with larger overlap when spanning two', () => {
    // Segment 1: row 0-50, Segment 2: row 50-100
    const seg1 = makeSeg({ line: 1, bbox: [0, 0, 200, 50] });
    const seg2 = makeSeg({ line: 2, bbox: [0, 50, 200, 100] });
    // Word overlaps seg1 by 10px height, seg2 by 30px height (width 50 for both)
    const word = makeWord('Overlap', [10, 40, 60, 80]);
    // seg1 overlap: 50 * 10 = 500, seg2 overlap: 50 * 30 = 1500

    const result = attachWordsToSegments([seg1, seg2], [word]);

    expect(result.enriched[0].visionWords).toHaveLength(0);
    expect(result.enriched[1].visionWords).toEqual([word]);
    expect(result.enriched[1].visionText).toBe('Overlap');
    expect(result.unassigned).toHaveLength(0);
  });

  it('puts a word with no overlap into unassigned', () => {
    const seg = makeSeg({ line: 1, bbox: [0, 0, 100, 50] });
    const word = makeWord('Far', [300, 300, 350, 330]);

    const result = attachWordsToSegments([seg], [word]);

    expect(result.enriched[0].visionWords).toHaveLength(0);
    expect(result.enriched[0].visionText).toBe('');
    expect(result.unassigned).toEqual([word]);
  });

  it('puts a word barely overlapping (below minOverlapRatio) into unassigned', () => {
    const seg = makeSeg({ line: 1, bbox: [0, 0, 200, 50] });
    // Word area: 100 * 40 = 4000, overlap: 1px * 40px = 40 → ratio = 0.01
    const word = makeWord('Barely', [199, 5, 299, 45]);

    const result = attachWordsToSegments([seg], [word]);

    expect(result.enriched[0].visionWords).toHaveLength(0);
    expect(result.unassigned).toEqual([word]);
  });

  it('sorts multiple words on one segment left-to-right and concatenates visionText', () => {
    const seg = makeSeg({ line: 1, bbox: [0, 0, 400, 50] });
    const wordC = makeWord('world', [150, 10, 200, 40]);
    const wordA = makeWord('Hello', [10, 10, 60, 40]);
    const wordB = makeWord('dear', [80, 10, 130, 40]);

    // Pass words out of order to verify sorting
    const result = attachWordsToSegments([seg], [wordC, wordA, wordB]);

    expect(result.enriched[0].visionWords).toEqual([wordA, wordB, wordC]);
    expect(result.enriched[0].visionText).toBe('Hello dear world');
  });

  it('returns enriched segment with empty visionWords when no words match', () => {
    const seg = makeSeg({ line: 1, bbox: [0, 0, 100, 50] });

    const result = attachWordsToSegments([seg], []);

    expect(result.enriched).toHaveLength(1);
    expect(result.enriched[0].visionWords).toEqual([]);
    expect(result.enriched[0].visionText).toBe('');
    expect(result.unassigned).toHaveLength(0);
  });

  it('handles empty inputs gracefully', () => {
    // No segments, no words
    const r1 = attachWordsToSegments([], []);
    expect(r1.enriched).toEqual([]);
    expect(r1.unassigned).toEqual([]);

    // No segments, some words → all unassigned
    const word = makeWord('Orphan', [10, 10, 60, 40]);
    const r2 = attachWordsToSegments([], [word]);
    expect(r2.enriched).toEqual([]);
    expect(r2.unassigned).toEqual([word]);

    // Some segments, no words
    const seg = makeSeg({ line: 1, bbox: [0, 0, 100, 50] });
    const r3 = attachWordsToSegments([seg], []);
    expect(r3.enriched).toHaveLength(1);
    expect(r3.enriched[0].visionWords).toEqual([]);
    expect(r3.unassigned).toEqual([]);
  });

  it('respects custom minOverlapRatio', () => {
    const seg = makeSeg({ line: 1, bbox: [0, 0, 200, 50] });
    // Word area: 50 * 30 = 1500, overlap: 20 * 30 = 600 → ratio = 0.4
    const word = makeWord('Partial', [180, 10, 230, 40]);

    // Default threshold 0.3 → should assign
    const r1 = attachWordsToSegments([seg], [word]);
    expect(r1.enriched[0].visionWords).toHaveLength(1);

    // Strict threshold 0.5 → should NOT assign (0.4 < 0.5)
    const r2 = attachWordsToSegments([seg], [word], { minOverlapRatio: 0.5 });
    expect(r2.enriched[0].visionWords).toHaveLength(0);
    expect(r2.unassigned).toEqual([word]);

    // Lenient threshold 0.1 → should assign
    const r3 = attachWordsToSegments([seg], [word], { minOverlapRatio: 0.1 });
    expect(r3.enriched[0].visionWords).toHaveLength(1);
  });

  it('does not mutate input segments or words', () => {
    const seg = makeSeg({ line: 1, bbox: [0, 0, 200, 50] });
    const word = makeWord('Hello', [10, 10, 60, 40]);

    // Snapshot originals
    const segCopy = JSON.parse(JSON.stringify(seg));
    const wordCopy = JSON.parse(JSON.stringify(word));

    attachWordsToSegments([seg], [word]);

    expect(seg).toEqual(segCopy);
    expect(word).toEqual(wordCopy);

    // Verify enriched segment is a different object
    const result = attachWordsToSegments([seg], [word]);
    expect(result.enriched[0]).not.toBe(seg);
  });
});
