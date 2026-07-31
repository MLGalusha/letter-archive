// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  TranscriptAlignmentPageResponse,
  TranscriptAlignmentSegment,
} from '../../../../api/admin/transcriptAlignment';
import TranscriptAlignmentCanvas from '../TranscriptAlignmentCanvas';

function segment(id: string, y: number): TranscriptAlignmentSegment {
  return {
    id,
    boundary: [
      { x: 10, y },
      { x: 90, y },
      { x: 90, y: y + 10 },
      { x: 10, y: y + 10 },
    ],
    baseline: [
      { x: 10, y: y + 8 },
      { x: 90, y: y + 8 },
    ],
    orientationDegrees: 0,
    readingOrderIndex: y / 20,
    recognizedText: id,
    recognitionConfidence: 0.8,
  };
}

const PAGE: TranscriptAlignmentPageResponse = {
  schemaVersion: 1,
  artifactSha256: 'artifact',
  run: {
    runId: 'run-one',
    createdAt: '2026-07-29T00:00:00.000Z',
    algorithm: 'content-aware-dp',
    layoutRunId: 'layout-one',
    recognizer: {
      runId: 'recognizer-one',
      modelSha256: 'model',
      segmentationType: 'baselines',
    },
  },
  page: {
    pageKey: '005-19150813-L01-01',
    letterKey: '005-19150813-L01',
    pageNumber: 1,
    originalFilename: '005-19150813-L01-01.jpg',
    challengeTags: [],
    image: {
      url: '/prepared',
      width: 100,
      height: 140,
      sha256: 'prepared',
    },
  },
  transcriptSource: {
    sha256: 'transcript',
    tier: 'legacy-confirmed',
    label: 'Confirmed transcript',
  },
  summary: {
    mappingCount: 3,
    statusCounts: { accepted: 2, ambiguous: 1, unlocated: 0 },
    skippedSegmentCount: 1,
    unassignedMappingCount: 0,
    reviewProgress: {
      reviewedCount: 0,
      totalCount: 3,
      percent: 0,
    },
  },
  segments: [
    segment('segment-a', 10),
    segment('segment-b', 30),
    segment('segment-c', 50),
    {
      ...segment('segment-skipped', 70),
      unassignedReason: 'secondary-flow',
    },
  ],
  items: [
    {
      id: 'split-item',
      sourceLineNumber: 1,
      transcriptText: 'A transcript line across two image lines',
      mapping: {
        status: 'ambiguous',
        operation: 'split',
        segmentIds: ['segment-a', 'segment-b'],
        similarity: 0.8,
        confidence: 0.7,
        alternatives: [],
      },
      review: null,
    },
    {
      id: 'merge-item-one',
      sourceLineNumber: 2,
      transcriptText: 'First half',
      mapping: {
        status: 'accepted',
        operation: 'merge',
        segmentIds: ['segment-c'],
        similarity: 0.9,
        confidence: 0.9,
        alternatives: [],
      },
      review: null,
    },
    {
      id: 'merge-item-two',
      sourceLineNumber: 3,
      transcriptText: 'Second half',
      mapping: {
        status: 'accepted',
        operation: 'merge',
        segmentIds: ['segment-c'],
        similarity: 0.9,
        confidence: 0.9,
        alternatives: [],
      },
      review: null,
    },
  ],
  skippedSegmentIds: ['segment-skipped'],
  deferredSegmentIds: [],
};

describe('TranscriptAlignmentCanvas', () => {
  it('highlights every image polygon in a split match and preserves unassigned evidence', () => {
    const { container } = render(
      <TranscriptAlignmentCanvas
        page={PAGE}
        imageUrl="blob:prepared"
        selectedItemId="split-item"
        zoom={1}
        onSelectItem={vi.fn()}
      />,
    );

    expect(container.querySelector(
      '[data-segment-id="segment-a"][data-status="selected"]',
    )).toBeInTheDocument();
    expect(container.querySelector(
      '[data-segment-id="segment-b"][data-status="selected"]',
    )).toBeInTheDocument();
    expect(container.querySelector(
      '[data-segment-id="segment-skipped"][data-status="skipped"]',
    )).toBeInTheDocument();
    expect(screen.getByRole('img', {
      name: /unassigned because it belongs to a separate text flow/i,
    })).toBeInTheDocument();
    expect(container.querySelector(
      '[data-unassigned-reason="secondary-flow"]',
    )).toBeInTheDocument();
  });

  it('explains a transcript mismatch in hover and accessibility text', () => {
    const mismatchPage = structuredClone(PAGE);
    const skippedSegment = mismatchPage.segments.find(
      ({ id }) => id === 'segment-skipped',
    );
    if (skippedSegment) skippedSegment.unassignedReason = 'transcript-mismatch';

    const { container } = render(
      <TranscriptAlignmentCanvas
        page={mismatchPage}
        imageUrl="blob:prepared"
        selectedItemId="split-item"
        zoom={1}
        onSelectItem={vi.fn()}
      />,
    );

    const reasonText = /page transcript and detected text do not correspond closely enough/i;
    expect(screen.getByRole('img', { name: reasonText })).toBeInTheDocument();
    expect(container.querySelector(
      '[data-unassigned-reason="transcript-mismatch"] title',
    )).toHaveTextContent(reasonText);
  });

  it('explains document text that was deliberately left unassigned', () => {
    const documentTextPage = structuredClone(PAGE);
    const skippedSegment = documentTextPage.segments.find(
      ({ id }) => id === 'segment-skipped',
    );
    if (skippedSegment) {
      skippedSegment.unassignedReason = 'non-transcribed-text';
    }

    const { container } = render(
      <TranscriptAlignmentCanvas
        page={documentTextPage}
        imageUrl="blob:prepared"
        selectedItemId="split-item"
        zoom={1}
        onSelectItem={vi.fn()}
      />,
    );

    const reasonText = /document text that was not transcribed/i;
    expect(screen.getByRole('img', { name: reasonText })).toBeInTheDocument();
    expect(container.querySelector(
      '[data-unassigned-reason="non-transcribed-text"] title',
    )).toHaveTextContent(reasonText);
  });

  it('distinguishes deferred rotated text from an ordinary unassigned detection', () => {
    const deferredPage = structuredClone(PAGE);
    deferredPage.segments.push({
      ...segment('segment-deferred', 90),
      orientationDegrees: 90,
      recognizedText: 'sideways note',
    });
    deferredPage.skippedSegmentIds.push('segment-deferred');
    deferredPage.deferredSegmentIds = ['segment-deferred'];

    const { container } = render(
      <TranscriptAlignmentCanvas
        page={deferredPage}
        imageUrl="blob:prepared"
        selectedItemId="split-item"
        zoom={1}
        onSelectItem={vi.fn()}
      />,
    );

    const deferredBoundary = container.querySelector(
      '[data-segment-id="segment-deferred"]',
    );
    const deferredOverlay = deferredBoundary?.closest(
      '.transcript-alignment-segment',
    );
    expect(deferredBoundary).toHaveAttribute('data-status', 'deferred');
    expect(deferredOverlay).toHaveClass('is-deferred');
    expect(deferredOverlay).not.toHaveClass('is-skipped');
    expect(deferredOverlay).toHaveTextContent(
      'deferred for rotated text review',
    );
  });

  it('does not silently cycle when the selected item shares one image segment', () => {
    const onSelectItem = vi.fn();
    render(
      <TranscriptAlignmentCanvas
        page={PAGE}
        imageUrl="blob:prepared"
        selectedItemId="merge-item-one"
        zoom={1}
        onSelectItem={onSelectItem}
      />,
    );

    fireEvent.click(screen.getByRole('button', {
      name: /matched to transcript lines 2, 3/i,
    }));

    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it('selects the first connected transcript line deterministically', () => {
    const onSelectItem = vi.fn();
    render(
      <TranscriptAlignmentCanvas
        page={PAGE}
        imageUrl="blob:prepared"
        selectedItemId="split-item"
        zoom={1}
        onSelectItem={onSelectItem}
      />,
    );

    fireEvent.click(screen.getByRole('button', {
      name: /matched to transcript lines 2, 3/i,
    }));

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem).toHaveBeenCalledWith('merge-item-one');
  });

  it('restores a saved correction while keeping the rejected proposal visible', () => {
    const correctedPage = structuredClone(PAGE);
    const splitItem = correctedPage.items.find((item) => item.id === 'split-item');
    if (!splitItem) throw new Error('Expected split item fixture');
    splitItem.review = {
      verdict: 'incorrect',
      correctSegmentIds: ['segment-skipped'],
      failureModes: ['wrong-line'],
      activeSeconds: 2,
      repairActions: 3,
      updatedAt: '2026-07-30T00:00:00.000Z',
    };

    const { container } = render(
      <TranscriptAlignmentCanvas
        page={correctedPage}
        imageUrl="blob:prepared"
        selectedItemId="split-item"
        zoom={1}
        onSelectItem={vi.fn()}
      />,
    );

    expect(container.querySelector(
      '.transcript-alignment-segment.is-saved-correction [data-segment-id="segment-skipped"]',
    )).toBeInTheDocument();
    expect(container.querySelectorAll(
      '.transcript-alignment-segment.is-rejected-proposal',
    )).toHaveLength(2);
  });

  it('makes every detected line selectable while correcting a wrong match', () => {
    const onToggleCorrectionSegment = vi.fn();
    render(
      <TranscriptAlignmentCanvas
        page={PAGE}
        imageUrl="blob:prepared"
        selectedItemId="split-item"
        zoom={1}
        onSelectItem={vi.fn()}
        correctionMode
        correctionSegmentIds={['segment-skipped']}
        onToggleCorrectionSegment={onToggleCorrectionSegment}
      />,
    );

    const unassignedLine = screen.getByRole('button', {
      name: /Remove Detected image line 4\.5, not matched to transcript text.*corrected geometry/i,
    });
    expect(unassignedLine).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(unassignedLine);
    expect(onToggleCorrectionSegment).toHaveBeenCalledWith('segment-skipped');
  });
});
