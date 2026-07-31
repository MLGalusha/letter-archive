// @vitest-environment jsdom

import { createRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LineReviewMode, { type LineReviewModeHandle } from '../LineReviewMode';
import { computeAutoScrollTop } from '../lineReviewUtils';
import { ApiError } from '../../../api/client';
import {
  getPageGeometry,
  savePageLineSegments,
  updatePageSegmentTrust,
  type PageGeometryEnvelope,
} from '../../../api/admin/letters';
import {
  getProductionTranscriptAlignment,
  type ProductionAlignmentPage,
  type ProductionTranscriptAlignmentEnvelope,
} from '../../../api/admin/productionTranscriptAlignment';
import {
  getCurrentRotationGeometryProposal,
  type CurrentRotationGeometryProposal,
} from '../../../api/admin/pageGeometryProposals';
import type { Letter, LineSegment, SegmentTrustState } from '../../../types/Letter';

const { getImageUrlMock } = vi.hoisted(() => ({
  getImageUrlMock: vi.fn((url: string) => `http://test${url}`),
}));

// Mock the client module
vi.mock('../../../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getImageUrl: getImageUrlMock,
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

// Mock the segment fetch API call
vi.mock('../../../api/admin/letters', () => ({
  getPageGeometry: vi.fn(),
  savePageLineSegments: vi.fn(),
  updatePageSegmentTrust: vi.fn(),
}));

vi.mock('../../../api/admin/productionTranscriptAlignment', () => ({
  getProductionTranscriptAlignment: vi.fn(),
}));

vi.mock('../../../api/admin/pageGeometryProposals', () => ({
  getCurrentRotationGeometryProposal: vi.fn(),
}));


vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

// jsdom doesn't implement scrollTo on elements
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: `test-letter-${overrides.primarySourceRevision ?? 0}`,
    title: 'Test Letter',
    primarySourceRevision: 0,
    transcriptRevision: 0,
    transcriptChecksumSha256: 'transcript',
    images: [
      {
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        originalFilename: 'page1.jpg',
        geometryRevision: 0,
        geometryChecksumSha256: 'geometry-0',
        lineSegmentsChecksumSha256: 'segments-0',
      },
    ],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Line one\nLine two\nLine three' }],
      fullText: 'Line one\nLine two\nLine three',
      verified: false,
    },
    metadata: {
      verified: false,
    },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'AI_DRAFT',
    metadataContentStatus: 'EMPTY',
    extraContentStatus: 'EMPTY',
    flagged: false,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function geometryEnvelope(
  lineSegments: LineSegment[],
  geometryRevision = 0,
  trustState: SegmentTrustState = 'unverified',
): PageGeometryEnvelope {
  const geometryChecksumSha256 = `geometry-${geometryRevision}`;
  return {
    lineSegments,
    geometryRevision,
    geometryChecksumSha256,
    lineSegmentsChecksumSha256: `segments-${geometryRevision}`,
    reviewState: {
      trustState,
      approvedGeometryRevision: trustState === 'trusted' ? geometryRevision : null,
      approvedGeometryChecksumSha256: trustState === 'trusted'
        ? geometryChecksumSha256
        : null,
      approvedBy: trustState === 'trusted' ? 'admin-1' : null,
      approvedAt: trustState === 'trusted' ? '2026-07-30T12:00:00.000Z' : null,
    },
  };
}

function withStableIds(segments: LineSegment[]): LineSegment[] {
  return segments.map((segment, index) => ({
    ...segment,
    id: segment.id ?? `segment-${index + 1}`,
  }));
}

function productionAlignmentPage(
  pageId: string,
  pageNumber: number,
  transcriptLines: string[],
  rawSegments: LineSegment[],
  options: {
    status?: ProductionAlignmentPage['status'];
    statusMessage?: string | null;
    segmentIdsByLine?: string[][];
    sourceLineNumbers?: number[];
  } = {},
): ProductionAlignmentPage {
  const segments = withStableIds(rawSegments);
  const segmentIdsByLine = options.segmentIdsByLine
    ?? transcriptLines.map((_line, index) => (
      segments[index]?.id ? [segments[index].id!] : []
    ));
  return {
    pageId,
    pageNumber,
    sourceChecksumSha256: null,
    geometry: geometryEnvelope(segments),
    recognition: {
      status: options.status === 'recognition-missing' ? 'missing' : 'ready',
      profileChecksumSha256: 'profile',
      exactArtifactChecksumSha256: options.status === 'recognition-missing'
        ? null
        : 'artifact',
      sourceArtifactChecksumsSha256: options.status === 'recognition-missing'
        ? []
        : ['artifact'],
      evidenceChecksumSha256: options.status === 'recognition-missing'
        ? null
        : 'evidence',
      validRecordCount: segments.length,
      alignableSegmentCount: segments.length,
    },
    inputFingerprintSha256: `fingerprint-${pageId}`,
    status: options.status ?? 'ready',
    statusMessage: options.statusMessage ?? null,
    transcriptLines: transcriptLines.map((text, transcriptLineIndex) => ({
      id: `${pageId}-line-${transcriptLineIndex}`,
      transcriptLineIndex,
      sourceLineNumber:
        options.sourceLineNumbers?.[transcriptLineIndex]
        ?? transcriptLineIndex + 1,
      text,
    })),
    mappings: transcriptLines.map((text, transcriptLineIndex) => {
      const segmentIds = segmentIdsByLine[transcriptLineIndex] ?? [];
      return {
        id: `${pageId}-mapping-${transcriptLineIndex}`,
        transcriptId: `${pageId}-line-${transcriptLineIndex}`,
        transcriptLineIndex,
        sourceLineNumber:
          options.sourceLineNumbers?.[transcriptLineIndex]
          ?? transcriptLineIndex + 1,
        transcriptText: text,
        segmentIds,
        operation: segmentIds.length === 0
          ? 'unlocated-transcript' as const
          : segmentIds.length > 1
            ? 'merge' as const
            : 'match' as const,
        similarity: segmentIds.length > 0 ? 0.9 : 0,
        confidence: segmentIds.length > 0 ? 0.9 : 0,
        status: segmentIds.length > 0
          ? 'accepted' as const
          : 'unlocated' as const,
        evidence: segmentIds.length > 0
          ? 'content' as const
          : 'unlocated' as const,
        alternatives: [],
      };
    }),
    unassignedSegments: [],
    deferredSegmentIds: [],
  };
}

function productionAlignmentEnvelope(
  letterId: string,
  primarySourceRevision = 0,
  pages: ProductionAlignmentPage[] = [
    productionAlignmentPage(
      'page-1',
      1,
      ['Line one', 'Line two', 'Line three'],
      makeDefaultSegments(),
    ),
    productionAlignmentPage(
      'page-2',
      2,
      ['Page 2 line C', 'Page 2 line D'],
      makeDefaultSegments().slice(0, 2),
    ),
  ],
  transcriptIdentity: {
    revision?: number;
    checksum?: string;
  } = {},
): ProductionTranscriptAlignmentEnvelope {
  return {
    schemaVersion: 1,
    algorithm: {
      name: 'content-aware-transcript-alignment',
      version: 'test',
      configChecksumSha256: 'config',
    },
    source: {
      letterId,
      primarySourceRevision,
      transcriptRevision: transcriptIdentity.revision ?? 0,
      transcriptChecksumSha256: transcriptIdentity.checksum ?? 'transcript',
    },
    pages,
  };
}

function makeDefaultSegments(): LineSegment[] {
  return [
    {
      line: 1,
      bbox: [50, 100, 450, 135],
      baseline: [[50, 135], [450, 135]],
      boundary: [
        { x: 50, y: 100 },
        { x: 450, y: 100 },
        { x: 450, y: 135 },
        { x: 50, y: 135 },
      ],
      ocrText: '',
    },
    {
      line: 2,
      bbox: [55, 140, 445, 175],
      baseline: [[55, 175], [445, 175]],
      boundary: [
        { x: 55, y: 140 },
        { x: 445, y: 140 },
        { x: 445, y: 175 },
        { x: 55, y: 175 },
      ],
      ocrText: '',
    },
    {
      line: 3,
      bbox: [50, 180, 450, 215],
      baseline: [[50, 215], [450, 215]],
      boundary: [
        { x: 50, y: 180 },
        { x: 450, y: 180 },
        { x: 450, y: 215 },
        { x: 50, y: 215 },
      ],
      ocrText: '',
    },
  ];
}

const ROTATION_SOURCE_CHECKSUM = 'a'.repeat(64);
const ROTATION_GEOMETRY_CHECKSUM = 'b'.repeat(64);
const ROTATION_SEGMENTS_CHECKSUM = 'c'.repeat(64);
const ROTATION_ARTIFACT_CHECKSUM = 'd'.repeat(64);
const ROTATION_PAGE_ID = '00000000-0000-4000-8000-000000000001';

function rotationProposal(
  imageSize = { width: 500, height: 700 },
): CurrentRotationGeometryProposal {
  return {
    id: 'rotation-proposal-1',
    artifactChecksumSha256: ROTATION_ARTIFACT_CHECKSUM,
    createdAt: '2026-07-31T12:00:00.000Z',
    artifact: {
      schemaVersion: 1,
      kind: 'rotation-recovery',
      pageId: ROTATION_PAGE_ID,
      source: {
        primarySourceRevision: 4,
        sourceChecksumSha256: ROTATION_SOURCE_CHECKSUM,
        baseGeometryRevision: 7,
        baseGeometryChecksumSha256: ROTATION_GEOMETRY_CHECKSUM,
        baseLineSegmentsChecksumSha256: ROTATION_SEGMENTS_CHECKSUM,
        image: {
          ...imageSize,
          checksumSha256: ROTATION_SOURCE_CHECKSUM,
        },
      },
      rotationProfile: {
        name: 'sideways-recovery-v1',
        evidenceContract: 'native-and-source-projected-v2',
        rotationsDegrees: [0, 90, 270],
        passOutcomes: [
          { rotationDegrees: 0, status: 'succeeded' },
          { rotationDegrees: 90, status: 'succeeded' },
          {
            rotationDegrees: 270,
            status: 'failed',
            error: {
              type: 'DetectorError',
              message: 'No usable lines',
            },
          },
        ],
        mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
        coordinateTransform: 'pil-pixel-centers-to-source-v1',
        selectionSummary: {
          rawInputLineCount: 4,
          inputLineCount: 3,
          clusterCount: 2,
          includedClusterCount: 1,
          rejectedClusterCount: 1,
          appendedRotatedLineCount: 1,
        },
      },
      run: { id: 'rotation-run-1' },
      candidates: [{
        id: 'sideways-candidate-1',
        line: -1,
        geometryType: 'baseline',
        providerTextDirection: 'vertical-rl',
        rotationEvidence: {
          evidenceContract: 'native-and-source-projected-v2',
          mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
          clusterIndex: 0,
          supportCount: 2,
          sourceRotationsDegrees: [90],
          sourcePassStatuses: ['succeeded'],
          representativeRotationDegrees: 90,
          representativeProviderOrdinal: 0,
          memberProviderIds: ['provider-sideways-1'],
          readingOrderSource: 'unresolved-rotated-proposal',
        },
        baseline: [[100, 120], [100, 260]],
        bbox: [90, 110, 120, 270],
        geometryProvenance: {
          source: 'machine',
          operation: 'detected',
          parentSegmentIds: [],
        },
        ocrText: '',
        boundary: [
          { x: 90, y: 110 },
          { x: 120, y: 110 },
          { x: 120, y: 270 },
          { x: 90, y: 270 },
        ],
      }],
    },
  };
}

function rotationReviewLetter(): Letter {
  return makeLetter({
    id: 'test-letter-4',
    primarySourceRevision: 4,
    images: [{
      id: ROTATION_PAGE_ID,
      type: 'letter',
      pageNumber: 1,
      imageUrl: '/images/rotation-page',
      originalFilename: 'rotation-page.jpg',
      sourceChecksum: ROTATION_SOURCE_CHECKSUM,
      geometryRevision: 7,
      geometryChecksumSha256: ROTATION_GEOMETRY_CHECKSUM,
      lineSegmentsChecksumSha256: ROTATION_SEGMENTS_CHECKSUM,
      lineSegments: makeDefaultSegments(),
    }],
  });
}

function rotationProductionAlignment(
  letter: Letter,
): ProductionTranscriptAlignmentEnvelope {
  const page = productionAlignmentPage(
    ROTATION_PAGE_ID,
    1,
    ['Line one', 'Line two', 'Line three'],
    letter.images[0].lineSegments ?? [],
  );
  page.sourceChecksumSha256 = ROTATION_SOURCE_CHECKSUM;
  page.geometry = {
    ...geometryEnvelope(letter.images[0].lineSegments ?? [], 7),
    geometryChecksumSha256: ROTATION_GEOMETRY_CHECKSUM,
    lineSegmentsChecksumSha256: ROTATION_SEGMENTS_CHECKSUM,
  };
  return productionAlignmentEnvelope(
    letter.id,
    letter.primarySourceRevision,
    [page],
  );
}

function makeMultiPageLetter(): Letter {
  return makeLetter({
    images: [
      {
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        originalFilename: 'page1.jpg',
      },
      {
        id: 'page-2',
        type: 'letter',
        pageNumber: 2,
        imageUrl: '/images/page-2',
        originalFilename: 'page2.jpg',
      },
    ],
    transcript: {
      pages: [
        { pageNumber: 1, text: 'Page 1 line A\nPage 1 line B' },
        { pageNumber: 2, text: 'Page 2 line C\nPage 2 line D' },
      ],
      fullText: '--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D',
      verified: false,
    },
  });
}

function makeSegmentTransitionLetter(): Letter {
  const makeSegments = () => [
    {
      line: 1,
      bbox: [50, 100, 450, 135] as [number, number, number, number],
      baseline: [[50, 135], [450, 135]],
      boundary: [
        { x: 50, y: 100 },
        { x: 450, y: 100 },
        { x: 450, y: 135 },
        { x: 50, y: 135 },
      ],
      ocrText: '',
      words: [],
    },
    {
      line: 2,
      bbox: [55, 140, 445, 175] as [number, number, number, number],
      baseline: [[55, 175], [445, 175]],
      boundary: [
        { x: 55, y: 140 },
        { x: 445, y: 140 },
        { x: 445, y: 175 },
        { x: 55, y: 175 },
      ],
      ocrText: '',
      words: [],
    },
  ];

  return makeLetter({
    primarySourceRevision: 9,
    images: [
      {
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        originalFilename: 'page1.jpg',
        sourceChecksum: 'page-1-checksum',
        geometryRevision: 0,
        geometryChecksumSha256: 'geometry-0',
        lineSegmentsChecksumSha256: 'segments-0',
        lineSegments: makeSegments(),
      },
      {
        id: 'page-2',
        type: 'letter',
        pageNumber: 2,
        imageUrl: '/images/page-2',
        originalFilename: 'page2.jpg',
        sourceChecksum: 'page-2-checksum',
        geometryRevision: 0,
        geometryChecksumSha256: 'geometry-0',
        lineSegmentsChecksumSha256: 'segments-0',
        lineSegments: makeSegments(),
      },
    ],
    transcript: {
      pages: [
        { pageNumber: 1, text: 'Page 1 line A\nPage 1 line B' },
        { pageNumber: 2, text: 'Page 2 line C\nPage 2 line D' },
      ],
      fullText: '--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D',
      verified: false,
    },
  });
}

function deleteFirstVisibleSegment(container: HTMLElement) {
  const segment = container.querySelector(
    '.segment-editor-rect, .segment-editor-poly',
  );
  expect(segment).toBeTruthy();
  if (segment) {
    fireEvent.pointerDown(segment, { pointerId: 1 });
  }

  const deleteButton = container.querySelector<HTMLButtonElement>(
    '.segment-editor-toolbar-btn[data-hint="Delete (Del)"]',
  );
  expect(deleteButton).toBeTruthy();
  if (deleteButton) {
    fireEvent.click(deleteButton);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Simulate image load and flush async (API promise + rAF)
async function simulateImageLoadAsync(container: HTMLElement) {
  const img = container.querySelector('img');
  if (img) {
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 700, configurable: true });
    Object.defineProperty(img, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'clientHeight', { value: 700, configurable: true });
    await act(async () => {
      fireEvent.load(img);
      // Flush the detectPageLines promise (microtask) + rAF pixel detection fallback
      await new Promise(r => setTimeout(r, 0));
    });
  }
}

function getEditable(container: HTMLElement): HTMLDivElement | null {
  return container.querySelector('.line-review-input-overlay .line-review-editable');
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LineReviewMode', () => {
  const getPageGeometryMock = vi.mocked(getPageGeometry);
  const savePageLineSegmentsMock = vi.mocked(savePageLineSegments);
  const updatePageSegmentTrustMock = vi.mocked(updatePageSegmentTrust);
  const getProductionTranscriptAlignmentMock = vi.mocked(
    getProductionTranscriptAlignment,
  );
  const getCurrentRotationGeometryProposalMock = vi.mocked(
    getCurrentRotationGeometryProposal,
  );
  const defaultProps = {
    letter: makeLetter(),
    transcript: 'Line one\nLine two\nLine three',
    onTranscriptChange: vi.fn(),
    onExit: vi.fn(),
    onAutoSave: vi.fn(),
    handleMutationError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.handleMutationError.mockReturnValue(false);
    getPageGeometryMock.mockReset().mockResolvedValue(
      geometryEnvelope(makeDefaultSegments()),
    );
    savePageLineSegmentsMock.mockReset().mockImplementation(
      async (_pageId, lineSegments, expected) => geometryEnvelope(
        lineSegments,
        expected.expectedGeometryRevision + 1,
      ),
    );
    updatePageSegmentTrustMock.mockReset().mockImplementation(
      async (_pageId, trustState, expected) => geometryEnvelope(
        makeDefaultSegments(),
        expected.expectedGeometryRevision,
        trustState,
      ),
    );
    getProductionTranscriptAlignmentMock.mockReset().mockImplementation(
      async (letterId) => {
        const revision = Number.parseInt(letterId.split('-').at(-1) ?? '0', 10);
        return productionAlignmentEnvelope(
          letterId,
          Number.isFinite(revision) ? revision : 0,
        );
      },
    );
    getCurrentRotationGeometryProposalMock.mockReset().mockResolvedValue({
      proposal: null,
    });
    // Reset requestAnimationFrame to run synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it('uses the cookie-authenticated image URL for a published orphan under review', async () => {
    render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({ visibility: 'PUBLISHED' })}
      />,
    );
    await flushEffects();

    expect(getImageUrlMock).toHaveBeenCalledWith('/images/page-1');
  });

  it('keeps its parent-facing handle stable across ordinary editor renders', async () => {
    const modeRef = createRef<LineReviewModeHandle>();
    const letterWithSegments = makeLetter({
      images: [{
        ...makeLetter().images[0],
        lineSegments: makeDefaultSegments(),
      }],
    });
    const { rerender } = render(
      <LineReviewMode
        {...defaultProps}
        ref={modeRef}
        letter={letterWithSegments}
      />,
    );
    await flushEffects();
    const initialHandle = modeRef.current;
    expect(initialHandle).toBeTruthy();

    rerender(
      <LineReviewMode
        {...defaultProps}
        ref={modeRef}
        letter={letterWithSegments}
      />,
    );
    await flushEffects();

    expect(modeRef.current).toBe(initialHandle);
  });

  it('flushes a fresh geometry edit through the parent handle before the debounce', async () => {
    const save = createDeferred<PageGeometryEnvelope>();
    savePageLineSegmentsMock.mockImplementationOnce(() => save.promise);
    const modeRef = createRef<LineReviewModeHandle>();
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        ref={modeRef}
        letter={makeSegmentTransitionLetter()}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    deleteFirstVisibleSegment(container);
    expect(modeRef.current?.hasPendingChanges()).toBe(true);
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();

    let flushed!: Promise<boolean>;
    act(() => {
      flushed = modeRef.current!.flushPendingChanges();
    });

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
    });
    const savedSegments = savePageLineSegmentsMock.mock.calls[0][1];
    await act(async () => {
      save.resolve(geometryEnvelope(savedSegments, 1));
      expect(await flushed).toBe(true);
    });

    expect(modeRef.current?.hasPendingChanges()).toBe(false);
  });

  it('reports and flushes an edited current line when geometry is clean', async () => {
    const onAutoSave = vi.fn();
    const modeRef = createRef<LineReviewModeHandle>();
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        ref={modeRef}
        onAutoSave={onAutoSave}
      />,
    );
    await simulateImageLoadAsync(container);

    expect(modeRef.current?.hasPendingChanges()).toBe(false);
    const input = getEditable(container);
    expect(input).toBeTruthy();
    if (input) {
      input.textContent = 'Fresh route-bound edit';
      fireEvent.input(input);
    }
    expect(modeRef.current?.hasPendingChanges()).toBe(true);

    await act(async () => {
      expect(await modeRef.current?.flushPendingChanges()).toBe(true);
    });

    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: expect.stringContaining(
          'Fresh route-bound edit',
        ),
      }),
    );
    expect(modeRef.current?.hasPendingChanges()).toBe(false);
  });

  it('locks transcript and geometry edits while route navigation is pending', async () => {
    const letter = makeSegmentTransitionLetter();
    const { container, rerender } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
      />,
    );
    await simulateImageLoadAsync(container);

    rerender(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        navigationPending
      />,
    );

    expect(getEditable(container)).toHaveAttribute(
      'contenteditable',
      'false',
    );
    expect(screen.getByRole('button', {
      name: 'Exit review mode',
    })).toBeDisabled();
    expect(screen.getByRole('button', {
      name: 'Next page',
    })).toBeDisabled();
  });

  it('saves a dirty draft before an ordinary reload and exposes reload loading', async () => {
    const save = createDeferred<PageGeometryEnvelope>();
    const reload = createDeferred<PageGeometryEnvelope>();
    savePageLineSegmentsMock.mockImplementationOnce(() => save.promise);
    getPageGeometryMock.mockImplementationOnce(() => reload.promise);
    const modeRef = createRef<LineReviewModeHandle>();
    const letter = makeSegmentTransitionLetter();
    let authoritativePageOneSegments = letter.images[0].lineSegments ?? [];
    getProductionTranscriptAlignmentMock.mockImplementation(async () => (
      productionAlignmentEnvelope(
        letter.id,
        letter.primarySourceRevision,
        [
          productionAlignmentPage(
            'page-1',
            1,
            ['Page 1 line A', 'Page 1 line B'],
            authoritativePageOneSegments,
          ),
          productionAlignmentPage(
            'page-2',
            2,
            ['Page 2 line C', 'Page 2 line D'],
            letter.images[1].lineSegments ?? [],
          ),
        ],
      )
    ));
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        ref={modeRef}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    deleteFirstVisibleSegment(container);
    act(() => {
      modeRef.current?.reloadSegments();
    });

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
      expect(modeRef.current?.isLoading).toBe(true);
    });
    expect(getPageGeometryMock).not.toHaveBeenCalled();

    const savedSegments = savePageLineSegmentsMock.mock.calls[0][1];
    authoritativePageOneSegments = savedSegments;
    await act(async () => {
      save.resolve(geometryEnvelope(savedSegments, 1));
      await save.promise;
    });
    await waitFor(() => {
      expect(getPageGeometryMock).toHaveBeenCalledWith('page-1');
    });
    expect(modeRef.current?.isLoading).toBe(true);

    await act(async () => {
      reload.resolve(geometryEnvelope(savedSegments, 1));
      await reload.promise;
    });
    await waitFor(() => {
      expect(modeRef.current?.isLoading).toBe(false);
    });
    expect(
      container.querySelectorAll('.segment-editor-rect, .segment-editor-poly'),
    ).toHaveLength(1);
  });

  it('keeps page navigation locked until a manual reload response settles', async () => {
    const reload = createDeferred<PageGeometryEnvelope>();
    getPageGeometryMock.mockImplementationOnce(() => reload.promise);
    const modeRef = createRef<LineReviewModeHandle>();
    const letter = makeSegmentTransitionLetter();
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        ref={modeRef}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    act(() => {
      modeRef.current?.reloadSegments();
    });
    await waitFor(() => {
      expect(getPageGeometryMock).toHaveBeenCalledWith('page-1');
      expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByAltText('Page 1')).toBeTruthy();

    await act(async () => {
      reload.resolve(geometryEnvelope(letter.images[0].lineSegments ?? []));
      await reload.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Next page' })).not.toBeDisabled();
    });
    expect(screen.getByAltText('Page 1')).toBeTruthy();
  });

  it('does not auto-detect when the page has no transcript yet', async () => {
    render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          transcript: {
            pages: [],
            fullText: '',
            verified: false,
          },
        })}
        transcript=""
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getPageGeometryMock).not.toHaveBeenCalled();
  });

  it('uses stored line segments without auto-detecting again', async () => {
    render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          images: [
            {
              id: 'page-1',
              type: 'letter',
              pageNumber: 1,
              imageUrl: '/images/page-1',
              originalFilename: 'page1.jpg',
              lineSegments: [
                {
                  line: 1,
                  baseline: [[50, 135], [450, 135]],
                  bbox: [50, 100, 450, 135],
                  ocrText: '',
                  words: [],
                },
              ],
            },
          ],
        })}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(getPageGeometryMock).not.toHaveBeenCalled();
  });

  it('renders the image', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await flushEffects();
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toContain('http://test/images/page-1');
  });

  it('shows progress indicator', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);
    expect(container.querySelector('.line-review-progress')).toBeTruthy();
  });

  it('renders an explicit close button', async () => {
    render(<LineReviewMode {...defaultProps} />);
    await flushEffects();

    expect(screen.getByRole('button', { name: 'Exit review mode' })).toBeTruthy();
  });

  it('calls onExit when the close button is pressed', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    fireEvent.click(screen.getByRole('button', { name: 'Exit review mode' }));
    await waitFor(() => {
      expect(defaultProps.onExit).toHaveBeenCalled();
    });
  });

  it('shows detecting message before image loads', async () => {
    render(<LineReviewMode {...defaultProps} />);
    await flushEffects();
    // Before image loads, no lines should be detected
    // The "Detecting lines..." should not show until image has natural size
    // (since we check imageNaturalSize.width > 0)
    const analyzing = screen.queryByText('Detecting line positions...');
    // Before image load, natural size is 0, so this should NOT show
    expect(analyzing).toBeNull();
  });

  it('renders input overlay with Kraken segments', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    expect(input?.textContent).toBe('Line one');
  });

  it('leaves full-screen segment editing before showing candidate comparison', async () => {
    const letter = rotationReviewLetter();
    getProductionTranscriptAlignmentMock.mockResolvedValue(
      rotationProductionAlignment(letter),
    );
    getCurrentRotationGeometryProposalMock.mockResolvedValue({
      proposal: rotationProposal(),
    });
    function CandidateReviewHarness() {
      const [debugMode, setDebugMode] = useState(false);
      return (
        <LineReviewMode
          {...defaultProps}
          letter={letter}
          fullViewport
          debugMode={debugMode}
          onDebugModeChange={setDebugMode}
        />
      );
    }
    const { container } = render(
      <CandidateReviewHarness />,
    );
    await simulateImageLoadAsync(container);

    const candidatesButton = screen.getByRole('button', {
      name: 'Candidates',
    });
    expect(candidatesButton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTitle('Switch to transcript editor')).toBeTruthy();

    fireEvent.click(candidatesButton);

    expect(await screen.findByTitle('Switch to segment editor')).toBeTruthy();
    expect(await screen.findByRole('button', {
      name: 'Sideways candidates · 1',
    })).toBeTruthy();
    expect(candidatesButton).toHaveAttribute('aria-pressed', 'true');
    expect(
      container.querySelector('.line-review-rotation-proposal-overlay'),
    ).toBeTruthy();
  });

  it('renders and toggles exact sideways candidates without changing current geometry', async () => {
    const letter = rotationReviewLetter();
    getProductionTranscriptAlignmentMock.mockResolvedValue(
      rotationProductionAlignment(letter),
    );
    getCurrentRotationGeometryProposalMock.mockResolvedValue({
      proposal: rotationProposal(),
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        debugMode
      />,
    );
    await simulateImageLoadAsync(container);

    const candidateToggle = await screen.findByRole('button', {
      name: 'Sideways candidates · 1',
    });
    expect(candidateToggle).toHaveAttribute(
      'title',
      '0° passed · 90° passed · 270° failed: No usable lines',
    );
    expect(
      container.querySelectorAll('.line-review-debug-polygon'),
    ).toHaveLength(3);
    expect(
      container.querySelectorAll('.line-review-rotation-proposal'),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll('.line-review-rotation-baseline'),
    ).toHaveLength(1);
    expect(
      container.querySelector('.line-review-rotation-proposal-overlay'),
    ).toHaveStyle({ pointerEvents: 'none' });

    fireEvent.click(candidateToggle);

    expect(
      container.querySelector('.line-review-rotation-proposal-overlay'),
    ).toBeNull();
    expect(
      container.querySelectorAll('.line-review-debug-polygon'),
    ).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: 'Current geometry' }),
    ).toBeTruthy();
  });

  it('hides sideways candidates while editing canonical segments', async () => {
    const letter = rotationReviewLetter();
    getProductionTranscriptAlignmentMock.mockResolvedValue(
      rotationProductionAlignment(letter),
    );
    getCurrentRotationGeometryProposalMock.mockResolvedValue({
      proposal: rotationProposal(),
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        debugMode
      />,
    );
    await simulateImageLoadAsync(container);
    await screen.findByRole('button', {
      name: 'Sideways candidates · 1',
    });
    expect(
      container.querySelector('.line-review-rotation-proposal-overlay'),
    ).toBeTruthy();

    fireEvent.click(screen.getByTitle('Switch to segment editor'));

    expect(
      container.querySelector('.line-review-rotation-proposal-overlay'),
    ).toBeNull();
    expect(
      container.querySelectorAll('.segment-editor-poly'),
    ).toHaveLength(3);
  });

  it('does not show a proposal whose raster dimensions differ from the page', async () => {
    const letter = rotationReviewLetter();
    getProductionTranscriptAlignmentMock.mockResolvedValue(
      rotationProductionAlignment(letter),
    );
    getCurrentRotationGeometryProposalMock.mockResolvedValue({
      proposal: rotationProposal({ width: 501, height: 700 }),
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        debugMode
      />,
    );
    await simulateImageLoadAsync(container);
    await waitFor(() => {
      expect(getCurrentRotationGeometryProposalMock).toHaveBeenCalled();
    });

    expect(
      screen.queryByRole('button', { name: /Sideways candidates/ }),
    ).toBeNull();
    expect(
      container.querySelector('.line-review-rotation-proposal-overlay'),
    ).toBeNull();
  });

  it('fails closed when the letter lacks revision-bound transcript identity', async () => {
    const letter = makeLetter({
      transcriptRevision: undefined,
      transcriptChecksumSha256: undefined,
    });
    const { container } = render(
      <LineReviewMode {...defaultProps} letter={letter} />,
    );
    await simulateImageLoadAsync(container);

    expect(getProductionTranscriptAlignmentMock).not.toHaveBeenCalled();
    expect(
      screen.getByText('Transcript placement could not be loaded.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Transcript placement requires a transcript revision and checksum',
      ),
    ).toBeTruthy();
    expect(getEditable(container)).toBeNull();
  });

  it('reviews unmatched transcript rows without inventing page geometry', async () => {
    const oneSegmentLetter = makeLetter({
      images: [{
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        originalFilename: 'page1.jpg',
        lineSegments: [{
          id: 'native-line',
          line: 1,
          geometryType: 'baseline',
          bbox: [50, 100, 450, 135],
          baseline: [[50, 135], [450, 135]],
          boundary: [
            { x: 50, y: 100 },
            { x: 450, y: 100 },
            { x: 450, y: 135 },
            { x: 50, y: 135 },
          ],
          ocrText: '',
          words: [],
        }],
      }],
    });
    getProductionTranscriptAlignmentMock.mockImplementation(async () => (
      productionAlignmentEnvelope(
        oneSegmentLetter.id,
        oneSegmentLetter.primarySourceRevision,
        [
          productionAlignmentPage(
            'page-1',
            1,
            ['Line one', 'Line two', 'Line three'],
            oneSegmentLetter.images[0].lineSegments ?? [],
            {
              segmentIdsByLine: [['native-line'], [], []],
            },
          ),
        ],
      )
    ));
    const { container } = render(
      <LineReviewMode {...defaultProps} letter={oneSegmentLetter} />,
    );
    await simulateImageLoadAsync(container);
    expect(container.querySelector('.line-review-highlight-svg')).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    const unlocated = screen.getByRole('group', {
      name: 'Transcript line without a detected page location',
    });
    expect(unlocated.textContent).toContain('No detected location');
    expect(
      unlocated.querySelector('.line-review-editable')?.textContent,
    ).toBe('Line two');
    expect(container.querySelector('.line-review-highlight-svg')).toBeNull();
    expect(container.querySelector('.line-review-input-overlay')).toBeNull();
  });

  it('does not verify segments when saving pending edits fails', async () => {
    savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
    const letter = makeLetter({
      primarySourceRevision: 7,
      images: [
        {
          id: 'page-1',
          type: 'letter',
          pageNumber: 1,
          imageUrl: '/images/page-1',
          originalFilename: 'page1.jpg',
          sourceChecksum: 'page-1-checksum',
          geometryRevision: 0,
          geometryChecksumSha256: 'geometry-0',
          lineSegmentsChecksumSha256: 'segments-0',
          lineSegments: [
            {
              line: 1,
              bbox: [50, 100, 450, 135],
              baseline: [[50, 135], [450, 135]],
              ocrText: '',
              words: [],
            },
          ],
        },
      ],
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    const segment = container.querySelector('.segment-editor-rect');
    expect(segment).toBeTruthy();
    if (segment) {
      fireEvent.pointerDown(segment, { pointerId: 1 });
    }
    const deleteButton = container.querySelector<HTMLButtonElement>(
      '.segment-editor-toolbar-btn[data-hint="Delete (Del)"]',
    );
    expect(deleteButton).toBeTruthy();
    if (deleteButton) {
      fireEvent.click(deleteButton);
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve page' }));
      await Promise.resolve();
    });

    expect(savePageLineSegmentsMock).toHaveBeenCalledWith(
      'page-1',
      [],
      {
        primarySourceRevision: 7,
        sourceChecksum: 'page-1-checksum',
        expectedGeometryRevision: 0,
        expectedLineSegmentsChecksumSha256: 'segments-0',
      },
    );
    expect(updatePageSegmentTrustMock).not.toHaveBeenCalled();
  });

  it('approves and reopens only the exact current page revision', async () => {
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeSegmentTransitionLetter()}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    fireEvent.click(screen.getByRole('button', { name: 'Approve page' }));

    await waitFor(() => {
      expect(updatePageSegmentTrustMock).toHaveBeenCalledWith(
        'page-1',
        'trusted',
        {
          primarySourceRevision: 9,
          sourceChecksum: 'page-1-checksum',
          expectedGeometryRevision: 0,
          expectedGeometryChecksumSha256: 'geometry-0',
        },
      );
    });
    expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText('Page approved')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => {
      expect(updatePageSegmentTrustMock).toHaveBeenLastCalledWith(
        'page-1',
        'unverified',
        {
          primarySourceRevision: 9,
          sourceChecksum: 'page-1-checksum',
          expectedGeometryRevision: 0,
          expectedGeometryChecksumSha256: 'geometry-0',
        },
      );
    });
    expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(2);
  });

  it('locks segment edits after exact approval while keeping exit and page navigation usable', async () => {
    const letter = makeSegmentTransitionLetter();
    const approvedSegments = letter.images[0].lineSegments ?? [];
    updatePageSegmentTrustMock.mockImplementationOnce(
      async (_pageId, _trustState, expected) => geometryEnvelope(
        approvedSegments,
        expected.expectedGeometryRevision,
        'trusted',
      ),
    );
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    const firstSegment = container.querySelector(
      '.segment-editor-rect, .segment-editor-poly',
    );
    expect(firstSegment).toBeTruthy();
    if (firstSegment) {
      fireEvent.pointerDown(firstSegment, { pointerId: 1 });
    }
    const segmentCount = container.querySelectorAll(
      '.segment-editor-rect, .segment-editor-poly',
    ).length;

    fireEvent.click(screen.getByRole('button', { name: 'Approve page' }));
    expect(await screen.findByText('Page approved')).toBeTruthy();

    const editorToolbar = container.querySelector('.segment-editor-toolbar');
    const toolbarButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.segment-editor-toolbar button'),
    );
    const deleteButton = container.querySelector<HTMLButtonElement>(
      '.segment-editor-toolbar-btn[data-hint="Delete (Del)"]',
    );
    expect(
      container.querySelector<SVGElement>('.segment-editor-svg')?.style.pointerEvents,
    ).toBe('none');
    expect(editorToolbar).toHaveAttribute('aria-disabled', 'true');
    expect(toolbarButtons.length).toBeGreaterThan(0);
    expect(toolbarButtons.every((button) => button.disabled)).toBe(true);
    expect(deleteButton).toBeDisabled();

    if (deleteButton) fireEvent.click(deleteButton);
    expect(fireEvent.keyDown(window, { key: 'Delete' })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'Backspace' })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'z', metaKey: true })).toBe(false);
    expect(
      container.querySelectorAll('.segment-editor-rect, .segment-editor-poly'),
    ).toHaveLength(segmentCount);
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Exit review mode' }));
    await waitFor(() => {
      expect(defaultProps.onExit).toHaveBeenCalledTimes(1);
    });

    const nextPage = screen.getByRole('button', { name: 'Next page' });
    expect(nextPage).toBeEnabled();
    fireEvent.click(nextPage);
    await waitFor(() => {
      expect(screen.getByAltText('Page 2')).toBeTruthy();
    });
  });

  it('stays locked after a failed Reopen and unlocks only after Reopen succeeds', async () => {
    const letter = makeSegmentTransitionLetter();
    const approvedSegments = letter.images[0].lineSegments ?? [];
    updatePageSegmentTrustMock
      .mockImplementationOnce(
        async (_pageId, _trustState, expected) => geometryEnvelope(
          approvedSegments,
          expected.expectedGeometryRevision,
          'trusted',
        ),
      )
      .mockRejectedValueOnce(new Error('reopen failed'))
      .mockImplementationOnce(
        async (_pageId, _trustState, expected) => geometryEnvelope(
          approvedSegments,
          expected.expectedGeometryRevision,
          'unverified',
        ),
      );
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    fireEvent.click(screen.getByRole('button', { name: 'Approve page' }));
    expect(await screen.findByText('Page approved')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => {
      expect(defaultProps.handleMutationError).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to unverify segments',
      );
    });
    expect(screen.getByText('Page approved')).toBeTruthy();
    expect(
      container.querySelector('.segment-editor-toolbar'),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      container.querySelector<SVGElement>('.segment-editor-svg')?.style.pointerEvents,
    ).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => {
      expect(screen.queryByText('Page approved')).toBeNull();
    });
    expect(
      container.querySelector('.segment-editor-toolbar'),
    ).toHaveAttribute('aria-disabled', 'false');
    expect(
      container.querySelector<HTMLButtonElement>(
        '.segment-editor-toolbar-btn[data-hint="Box (B)"]',
      ),
    ).toBeEnabled();
    expect(
      container.querySelector<SVGElement>('.segment-editor-svg')?.style.pointerEvents,
    ).toBe('');
    expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces a conflict instead of adopting approval metadata for a newer projection', async () => {
    updatePageSegmentTrustMock.mockResolvedValueOnce({
      ...geometryEnvelope(makeDefaultSegments(), 0, 'trusted'),
      lineSegmentsChecksumSha256: 'segments-from-another-reviewer',
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeSegmentTransitionLetter()}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    fireEvent.click(screen.getByRole('button', { name: 'Approve page' }));

    await waitFor(() => {
      expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Newer edits exist — reload')).toBeTruthy();
    });
    expect(screen.queryByText('Page approved')).toBeNull();
  });

  it('surfaces a conflict instead of reopening against a newer projection', async () => {
    const letter = makeSegmentTransitionLetter();
    letter.images[0] = {
      ...letter.images[0],
      segmentTrustState: 'trusted',
    };
    updatePageSegmentTrustMock.mockResolvedValueOnce({
      ...geometryEnvelope(makeDefaultSegments(), 0, 'unverified'),
      lineSegmentsChecksumSha256: 'segments-from-another-reviewer',
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() => {
      expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Newer edits exist — reload')).toBeTruthy();
    });
    expect(screen.getByText('Page approved')).toBeTruthy();
  });

  it('makes the page read-only while an approval request owns the saved revision', async () => {
    const approval = createDeferred<PageGeometryEnvelope>();
    updatePageSegmentTrustMock.mockImplementationOnce(() => approval.promise);
    const letter = makeSegmentTransitionLetter();
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    const firstSegment = container.querySelector(
      '.segment-editor-rect, .segment-editor-poly',
    );
    expect(firstSegment).toBeTruthy();
    if (firstSegment) {
      fireEvent.pointerDown(firstSegment, { pointerId: 1 });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Approve page' }));

    await waitFor(() => {
      expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Approve page' })).toBeDisabled();
    });
    expect(
      container.querySelector<SVGElement>('.segment-editor-svg')?.style.pointerEvents,
    ).toBe('none');
    expect(
      container.querySelector('.segment-editor-toolbar'),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(
      container.querySelectorAll('.segment-editor-rect, .segment-editor-poly'),
    ).toHaveLength(2);
    expect(screen.getByAltText('Page 1')).toBeTruthy();
    expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      approval.resolve(geometryEnvelope(
        letter.images[0].lineSegments ?? [],
        0,
        'trusted',
      ));
      await approval.promise;
    });
    expect(await screen.findByText('Page approved')).toBeTruthy();
  });

  it('does not adopt an approval response after the page becomes mutation-blocked', async () => {
    const approval = createDeferred<PageGeometryEnvelope>();
    updatePageSegmentTrustMock.mockImplementationOnce(() => approval.promise);
    const letter = makeSegmentTransitionLetter();
    const { container, rerender } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    fireEvent.click(screen.getByRole('button', { name: 'Approve page' }));
    await waitFor(() => {
      expect(updatePageSegmentTrustMock).toHaveBeenCalledTimes(1);
    });
    rerender(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
        mutationsBlocked
      />,
    );

    await act(async () => {
      approval.resolve(geometryEnvelope(
        letter.images[0].lineSegments ?? [],
        0,
        'trusted',
      ));
      await approval.promise;
    });

    expect(screen.queryByText('Page approved')).toBeNull();
    expect(screen.getByText('Newer edits exist — reload')).toBeTruthy();
  });

  it('shows who owns the selected geometry without covering the scan', async () => {
    const letter = makeLetter({
      images: [{
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        geometryRevision: 2,
        geometryChecksumSha256: 'geometry-2',
        lineSegmentsChecksumSha256: 'segments-2',
        lineSegments: [{
          id: 'human-line-1',
          line: 1,
          bbox: [50, 100, 450, 135],
          baseline: [[50, 135], [450, 135]],
          ocrText: '',
          geometryProvenance: {
            source: 'human-created',
            operation: 'create-box',
            parentSegmentIds: [],
          },
        }],
      }],
    });
    getProductionTranscriptAlignmentMock.mockResolvedValueOnce(
      productionAlignmentEnvelope(
        letter.id,
        letter.primarySourceRevision,
        [
          productionAlignmentPage(
            'page-1',
            1,
            ['Line one', 'Line two', 'Line three'],
            letter.images[0].lineSegments ?? [],
            {
              segmentIdsByLine: [['human-line-1'], [], []],
            },
          ),
        ],
      ),
    );
    const { container } = render(
      <LineReviewMode {...defaultProps} letter={letter} fullViewport />,
    );
    await simulateImageLoadAsync(container);

    const segment = container.querySelector('.segment-editor-rect');
    expect(segment).toBeTruthy();
    if (segment) fireEvent.pointerDown(segment, { pointerId: 1 });

    expect(screen.getByText('Human-created')).toBeTruthy();
  });

  it('surfaces a same-page revision conflict and keeps the unsaved edit', async () => {
    savePageLineSegmentsMock.mockRejectedValueOnce(
      new ApiError(409, 'A newer geometry revision exists'),
    );
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeSegmentTransitionLetter()}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    deleteFirstVisibleSegment(container);
    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    await waitFor(() => {
      expect(screen.getByText('Newer edits exist — reload')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(
      container.querySelector<HTMLButtonElement>('.seg-editor-action-btn.danger')?.disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => {
      expect(getPageGeometryMock).toHaveBeenCalledWith('page-1');
      expect(
        container.querySelector<HTMLButtonElement>('.seg-editor-action-btn.danger')?.disabled,
      ).toBe(true);
    });
    expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued segment save when mutations become terminal', async () => {
    const letter = makeSegmentTransitionLetter();
    const { container, rerender } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    vi.useFakeTimers();
    try {
      deleteFirstVisibleSegment(container);
      rerender(
        <LineReviewMode
          {...defaultProps}
          letter={letter}
          fullViewport
          mutationsBlocked
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
      expect(updatePageSegmentTrustMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps segment edit mode, dirty state, and undo history when mode-exit save fails', async () => {
    savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeSegmentTransitionLetter()}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    deleteFirstVisibleSegment(container);
    const undoButton = container.querySelector<HTMLButtonElement>(
      '.segment-editor-toolbar-btn[data-hint="Undo (⌘Z)"]',
    );
    expect(undoButton?.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy();
    expect(
      container.querySelector<HTMLButtonElement>('.seg-editor-action-btn.danger')?.disabled,
    ).toBe(false);
    expect(undoButton?.disabled).toBe(false);

    if (undoButton) {
      fireEvent.click(undoButton);
    }
    expect(
      container.querySelectorAll('.segment-editor-rect, .segment-editor-poly'),
    ).toHaveLength(2);
  });

  it.each([
    {
      navigationLabel: 'Next page',
      initialPageIndex: 0,
      expectedPageNumber: 1,
      expectedPageId: 'page-1',
      expectedChecksum: 'page-1-checksum',
    },
    {
      navigationLabel: 'Previous page',
      initialPageIndex: 1,
      expectedPageNumber: 2,
      expectedPageId: 'page-2',
      expectedChecksum: 'page-2-checksum',
    },
  ])(
    'keeps the current page and dirty segment mode when $navigationLabel save fails',
    async ({
      navigationLabel,
      initialPageIndex,
      expectedPageNumber,
      expectedPageId,
      expectedChecksum,
    }) => {
      savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
      const { container } = render(
        <LineReviewMode
          {...defaultProps}
          letter={makeSegmentTransitionLetter()}
          transcript="--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D"
          initialPageIndex={initialPageIndex}
          fullViewport
        />,
      );
      await simulateImageLoadAsync(container);

      deleteFirstVisibleSegment(container);
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));

      await waitFor(() => {
        expect(savePageLineSegmentsMock).toHaveBeenCalledWith(
          expectedPageId,
          expect.any(Array),
          {
            primarySourceRevision: 9,
            sourceChecksum: expectedChecksum,
            expectedGeometryRevision: 0,
            expectedLineSegmentsChecksumSha256: 'segments-0',
          },
        );
      });
      expect(defaultProps.handleMutationError).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to save segment edits',
      );
      expect(screen.getByAltText(`Page ${expectedPageNumber}`)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy();
      expect(
        container.querySelector<HTMLButtonElement>('.seg-editor-action-btn.danger')?.disabled,
      ).toBe(false);
    },
  );

  it('keeps the review open with dirty segment history when full-exit save fails', async () => {
    savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
    const onExit = vi.fn();
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeSegmentTransitionLetter()}
        onExit={onExit}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    deleteFirstVisibleSegment(container);
    fireEvent.click(screen.getByRole('button', { name: 'Exit review mode' }));

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
    });
    expect(defaultProps.handleMutationError).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to save segment edits',
    );
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy();
    expect(
      container.querySelector<HTMLButtonElement>(
        '.segment-editor-toolbar-btn[data-hint="Undo (⌘Z)"]',
      )?.disabled,
    ).toBe(false);
  });

  it.each([
    {
      navigationLabel: 'Next page',
      initialPageIndex: 0,
      initialPageNumber: 1,
      destinationPageNumber: 2,
      sourcePageId: 'page-1',
      sourceChecksum: 'page-1-checksum',
    },
    {
      navigationLabel: 'Previous page',
      initialPageIndex: 1,
      initialPageNumber: 2,
      destinationPageNumber: 1,
      sourcePageId: 'page-2',
      sourceChecksum: 'page-2-checksum',
    },
  ])(
    'flushes edits made during a slow save before $navigationLabel navigation',
    async ({
      navigationLabel,
      initialPageIndex,
      initialPageNumber,
      destinationPageNumber,
      sourcePageId,
      sourceChecksum,
    }) => {
      const firstSave = createDeferred<PageGeometryEnvelope>();
      const secondSave = createDeferred<PageGeometryEnvelope>();
      savePageLineSegmentsMock
        .mockImplementationOnce(() => firstSave.promise)
        .mockImplementationOnce(() => secondSave.promise);
      const { container } = render(
        <LineReviewMode
          {...defaultProps}
          letter={makeSegmentTransitionLetter()}
          transcript="--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D"
          initialPageIndex={initialPageIndex}
          fullViewport
        />,
      );
      await simulateImageLoadAsync(container);

      deleteFirstVisibleSegment(container);
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));

      await waitFor(() => {
        expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByAltText(`Page ${initialPageNumber}`)).toBeTruthy();

      // The first request contains the first edit. Make a second edit before
      // it resolves; this newer snapshot must be saved before navigation.
      expect(savePageLineSegmentsMock.mock.calls[0]?.[1]).toHaveLength(1);
      deleteFirstVisibleSegment(container);

      await act(async () => {
        firstSave.resolve(geometryEnvelope(
          savePageLineSegmentsMock.mock.calls[0]?.[1] ?? [],
          1,
        ));
        await firstSave.promise;
      });
      await waitFor(() => {
        expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(2);
      });
      expect(savePageLineSegmentsMock).toHaveBeenLastCalledWith(
        sourcePageId,
        [],
        {
          primarySourceRevision: 9,
          sourceChecksum,
          expectedGeometryRevision: 1,
          expectedLineSegmentsChecksumSha256: 'segments-1',
        },
      );
      expect(screen.getByAltText(`Page ${initialPageNumber}`)).toBeTruthy();

      await act(async () => {
        secondSave.resolve(geometryEnvelope([], 2));
        await secondSave.promise;
      });
      await waitFor(() => {
        expect(screen.getByAltText(`Page ${destinationPageNumber}`)).toBeTruthy();
      });
    },
  );

  it('shows geometry repair context without entering special-segment mapping mode', async () => {
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        repairText="Hi."
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    const repairBanner = container.querySelector('.line-review-repair-banner');
    expect(repairBanner).toHaveTextContent('Repair location for:');
    expect(repairBanner).toHaveTextContent('Hi.');
    expect(repairBanner).toHaveTextContent(
      'this text is not assigned directly to a box',
    );
    expect(screen.queryByText('Map to segment:')).not.toBeInTheDocument();
    expect(container.querySelector('.seg-mappable')).toBeNull();
    expect(container.querySelector('[data-hint="Box (B)"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.querySelector('.line-review-repair-banner')).toBeNull();
  });

  it('keeps transcript rows reviewable when Kraken returns no segments', async () => {
    getPageGeometryMock.mockResolvedValueOnce(geometryEnvelope([]));
    getProductionTranscriptAlignmentMock.mockImplementation(async (letterId) => (
      productionAlignmentEnvelope(
        letterId,
        0,
        [
          productionAlignmentPage(
            'page-1',
            1,
            ['Line one', 'Line two', 'Line three'],
            [],
            {
              status: 'recognition-missing',
              statusMessage: 'Recognition is not available for this geometry.',
              segmentIdsByLine: [[], [], []],
            },
          ),
        ],
      )
    ));

    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeNull();
    const unlocated = screen.getByRole('group', {
      name: 'Transcript line without a detected page location',
    });
    expect(
      unlocated.querySelector('.line-review-editable')?.textContent,
    ).toBe('Line one');
    expect(container.querySelector('.line-review-highlight-svg')).toBeNull();
  });

  it('advances to next line on ArrowDown', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Initially on first line
    let input = getEditable(container);
    expect(input?.textContent).toBe('Line one');

    // Press ArrowDown
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    input = getEditable(container);
    expect(input?.textContent).toBe('Line two');
  });

  it('advances to next line on Enter', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    const input = getEditable(container);
    expect(input?.textContent).toBe('Line two');
  });

  it('goes to previous line on ArrowUp', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Go to line 2 first
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    // Then back to line 1
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });

    const input = getEditable(container);
    expect(input?.textContent).toBe('Line one');
  });

  it('does not go before first line', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Press ArrowUp on first line — should stay on first line
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });

    const input = getEditable(container);
    expect(input?.textContent).toBe('Line one');
  });

  it('does not trigger auto-save when navigating without edits', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    // No edits were made — save should NOT fire
    expect(defaultProps.onAutoSave).not.toHaveBeenCalled();
  });

  it('does not trigger onTranscriptChange when navigating without edits', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(defaultProps.onTranscriptChange).not.toHaveBeenCalled();
  });

  it('does not treat original transcript spacing as a review edit', async () => {
    const spacedTranscript = 'Line   one\nLine two\nLine three';
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          transcript: {
            pages: [{ pageNumber: 1, text: spacedTranscript }],
            fullText: spacedTranscript,
            verified: false,
          },
        })}
        transcript={spacedTranscript}
      />,
    );
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(defaultProps.onAutoSave).not.toHaveBeenCalled();
    expect(defaultProps.onTranscriptChange).not.toHaveBeenCalled();
  });

  it('saves edited text when navigating away', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Edit the current input
    const input = getEditable(container);
    expect(input).toBeTruthy();
    if (input) {
      input.textContent = 'Edited line one';
      fireEvent.input(input);
    }

    // Navigate away — should save
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    // The saved transcript should contain the edit
    expect(defaultProps.onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: expect.stringContaining('Edited line one'),
      }),
    );
  });

  it('edits the aligned content line without overwriting a decorative page number', async () => {
    const transcript =
      '— 2 —\n\nActual first line\n\nActual second line';
    const segments = withStableIds(makeDefaultSegments().slice(0, 2));
    const letter = makeLetter({
      images: [{
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        geometryRevision: 0,
        geometryChecksumSha256: 'geometry-0',
        lineSegmentsChecksumSha256: 'segments-0',
        lineSegments: segments,
      }],
      transcript: {
        pages: [{ pageNumber: 1, text: transcript }],
        fullText: transcript,
        verified: false,
      },
    });
    getProductionTranscriptAlignmentMock.mockResolvedValueOnce(
      productionAlignmentEnvelope(
        letter.id,
        letter.primarySourceRevision,
        [
          productionAlignmentPage(
            'page-1',
            1,
            ['Actual first line', 'Actual second line'],
            segments,
            {
              sourceLineNumbers: [3, 5],
            },
          ),
        ],
      ),
    );
    const onAutoSave = vi.fn();
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        transcript={transcript}
        onAutoSave={onAutoSave}
      />,
    );
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input?.textContent).toBe('Actual first line');
    if (input) {
      input.textContent = 'Revised first line';
      fireEvent.input(input);
    }
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(onAutoSave).toHaveBeenCalledWith({
      transcriptionText:
        '— 2 —\n\nRevised first line\n\nActual second line',
    });
  });

  it('flushes the edited line before unmount when saveCurrentLine is called', async () => {
    const onTranscriptChange = vi.fn();
    const onAutoSave = vi.fn();
    const ref = createRef<LineReviewModeHandle>();
    const { container, unmount } = render(
      <LineReviewMode
        {...defaultProps}
        ref={ref}
        onTranscriptChange={onTranscriptChange}
        onAutoSave={onAutoSave}
      />,
    );
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    if (input) {
      input.textContent = 'Exit save line';
      fireEvent.input(input);
    }

    act(() => {
      ref.current?.saveCurrentLine();
      unmount();
    });

    expect(onTranscriptChange).toHaveBeenCalledWith(
      expect.stringContaining('Exit save line'),
    );
    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: expect.stringContaining('Exit save line'),
      }),
    );
  });

  it('preserves original transcript spacing when saving a word edit', async () => {
    const spacedTranscript = 'Line   one\nLine two\nLine three';
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          transcript: {
            pages: [{ pageNumber: 1, text: spacedTranscript }],
            fullText: spacedTranscript,
            verified: false,
          },
        })}
        transcript={spacedTranscript}
      />,
    );
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    if (input) {
      input.textContent = 'Line revised';
      fireEvent.input(input);
    }

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(defaultProps.onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: expect.stringContaining('Line   revised'),
      }),
    );
  });

  it('renders dimmer divs for highlighting', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    expect(container.querySelector('.line-review-highlight-svg')).toBeTruthy();
    expect(container.querySelector('.line-review-dimmer-fill')).toBeTruthy();
  });

  it('filters to letter-type pages only', async () => {
    const letterWithMixed = makeLetter({
      images: [
        { id: 'p1', type: 'letter', pageNumber: 1, imageUrl: '/images/p1' },
        { id: 'p2', type: 'photo', pageNumber: 2, imageUrl: '/images/p2' },
        { id: 'p3', type: 'cover', pageNumber: 3, imageUrl: '/images/p3' },
      ],
    });

    const { container } = render(
      <LineReviewMode {...defaultProps} letter={letterWithMixed} />,
    );
    await flushEffects();

    // Should only show the letter-type image, not photo or cover
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('http://test/images/p1');
  });

  describe('multi-page navigation', () => {
    it('shows page count for multi-page letters', async () => {
      const { container } = render(
        <LineReviewMode
          {...defaultProps}
          letter={makeMultiPageLetter()}
          transcript="--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D"
        />,
      );
      await simulateImageLoadAsync(container);

      expect(container.textContent).toContain('Page 1 / 2');
    });

    it('does not show page count for single-page letters', async () => {
      const { container } = render(<LineReviewMode {...defaultProps} />);
      await simulateImageLoadAsync(container);

      expect(container.textContent).not.toContain('Page 1 / 2');
    });
  });

  describe('computeAutoScrollTop', () => {
    it('waits until the active line moves past the scroll threshold', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 3,
          movementDirection: 'down',
          currentScrollTop: 0,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 250,
          regionBottom: 340,
        }),
      ).toBeNull();
    });

    it('scrolls with a buffer once the active line passes the threshold', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 3,
          movementDirection: 'down',
          currentScrollTop: 0,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 320,
          regionBottom: 420,
        }),
      ).toBe(247);
    });

    it('stops scrolling once the container is already at the bottom', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 15,
          movementDirection: 'down',
          currentScrollTop: 800,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 1100,
          regionBottom: 1220,
        }),
      ).toBeNull();
    });

    it('scrolls back up when the active line moves above the top threshold', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 8,
          movementDirection: 'up',
          currentScrollTop: 500,
          viewportHeight: 600,
          contentHeight: 1600,
          regionTop: 650,
          regionBottom: 750,
        }),
      ).toBe(223);
    });

    it('returns to the top when navigating back to the first line', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 0,
          movementDirection: 'up',
          currentScrollTop: 120,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 30,
          regionBottom: 80,
        }),
      ).toBe(0);
    });

    it('does not trigger upward correction while moving down', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 8,
          movementDirection: 'down',
          currentScrollTop: 500,
          viewportHeight: 600,
          contentHeight: 1600,
          regionTop: 650,
          regionBottom: 750,
        }),
      ).toBeNull();
    });
  });
});
