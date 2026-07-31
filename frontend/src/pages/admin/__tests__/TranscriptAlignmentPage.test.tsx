// @vitest-environment jsdom

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TranscriptAlignmentFailureMode,
  TranscriptAlignmentPageResponse,
} from '../../../api/admin/transcriptAlignment';
import { ApiError } from '../../../api/client';

const alignmentApi = vi.hoisted(() => ({
  getTranscriptAlignmentIndex: vi.fn(),
  getTranscriptAlignmentPage: vi.fn(),
  putTranscriptAlignmentReview: vi.fn(),
}));
const imageApi = vi.hoisted(() => ({
  getLayoutBenchmarkImageObjectUrl: vi.fn(),
}));
const lettersApi = vi.hoisted(() => ({
  getAdminLetters: vi.fn(),
  getAdminLetterById: vi.fn(),
}));

vi.mock('../../../api/admin/transcriptAlignment', () => alignmentApi);
vi.mock('../../../api/admin/layoutBenchmark', () => imageApi);
vi.mock('../../../api/letters', () => lettersApi);
vi.mock('../../../components/AdminLayout/AdminLayout', () => ({
  default: ({ children, fullHeight }: {
    children: React.ReactNode;
    fullHeight?: boolean;
  }) => <div data-full-height={String(Boolean(fullHeight))}>{children}</div>,
}));

import TranscriptAlignmentPage from '../TranscriptAlignmentPage';

const RUN_INDEX = {
  schemaVersion: 1 as const,
  runs: [{
    runId: 'mccatmus-dp-v1',
    createdAt: '2026-07-29T00:00:00.000Z',
    letterCount: 1,
    pageCount: 1,
    mappingCount: 2,
    statusCounts: { accepted: 0, ambiguous: 1, unlocated: 1 },
    letters: [{
      letterKey: '005-19150813-L01',
      pageKeys: ['005-19150813-L01-01'],
      mappingCount: 2,
      statusCounts: { accepted: 0, ambiguous: 1, unlocated: 1 },
      unassignedMappingCount: 1,
    }],
  }],
  invalidRuns: [],
};

const PAGE: TranscriptAlignmentPageResponse = {
  schemaVersion: 1 as const,
  artifactSha256: 'artifact',
  run: {
    runId: 'mccatmus-dp-v1',
    createdAt: '2026-07-29T00:00:00.000Z',
    algorithm: 'k-best-monotonic-dp',
    layoutRunId: 'kraken7-layout',
    recognizer: {
      runId: 'mccatmus-recognition',
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
      url: '/images/layout-benchmark/prepared',
      width: 100,
      height: 140,
      sha256: 'prepared',
    },
  },
  transcriptSource: {
    sha256: 'transcript',
    tier: 'legacy-confirmed' as const,
    label: 'Legacy-confirmed transcript',
  },
  summary: {
    mappingCount: 2,
    statusCounts: { accepted: 0, ambiguous: 1, unlocated: 1 },
    skippedSegmentCount: 1,
    unassignedMappingCount: 1,
    reviewProgress: {
      reviewedCount: 0,
      totalCount: 2,
      percent: 0,
    },
  },
  segments: [{
    id: 'segment-a',
    boundary: [
      { x: 10, y: 10 },
      { x: 90, y: 10 },
      { x: 90, y: 20 },
      { x: 10, y: 20 },
    ],
    baseline: null,
    orientationDegrees: 0,
    readingOrderIndex: 0,
    recognizedText: '970 Lexinglon Ave',
    recognitionConfidence: 0.75,
  }, {
    id: 'segment-b',
    boundary: [
      { x: 10, y: 22 },
      { x: 90, y: 22 },
      { x: 90, y: 32 },
      { x: 10, y: 32 },
    ],
    baseline: null,
    orientationDegrees: 0,
    readingOrderIndex: 1,
    recognizedText: 'New York',
    recognitionConfidence: 0.78,
  }],
  items: [{
    id: 'mapping-one',
    sourceLineNumber: 1,
    transcriptText: '970 Lexington Avenue, New York',
    mapping: {
      status: 'ambiguous' as const,
      operation: 'split' as const,
      segmentIds: ['segment-a', 'segment-b'],
      similarity: 0.83,
      confidence: 0.72,
      alternatives: [{
        segmentIds: ['segment-a'],
        support: 0.2,
      }],
    },
    review: null,
  }, {
    id: 'mapping-two',
    sourceLineNumber: 2,
    transcriptText: 'My dear friend,',
    mapping: {
      status: 'unlocated' as const,
      operation: 'unlocated-transcript' as const,
      segmentIds: [],
      similarity: 0,
      confidence: 0.2,
      alternatives: [{
        segmentIds: [],
        support: 1,
      }],
    },
    review: null,
  }],
  skippedSegmentIds: [],
  deferredSegmentIds: [],
};

describe('TranscriptAlignmentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alignmentApi.getTranscriptAlignmentIndex.mockResolvedValue(RUN_INDEX);
    alignmentApi.getTranscriptAlignmentPage.mockResolvedValue(PAGE);
    alignmentApi.putTranscriptAlignmentReview.mockImplementation((
      _runId: string,
      _pageKey: string,
      transcriptId: string,
      input: {
        verdict: 'correct' | 'incorrect' | 'unsure';
        correctSegmentIds?: string[];
        failureModes: TranscriptAlignmentFailureMode[];
        repairActions?: number;
      },
    ) => Promise.resolve({
      review: {
        verdict: input.verdict,
        correctSegmentIds: input.correctSegmentIds ?? [],
        failureModes: input.failureModes,
        activeSeconds: 1,
        repairActions: input.repairActions ?? 0,
        updatedAt: '2026-07-29T01:00:00.000Z',
      },
      progress: {
        reviewedCount: transcriptId === 'mapping-one' ? 1 : 2,
        totalCount: 2,
        percent: transcriptId === 'mapping-one' ? 50 : 100,
      },
    }));
    imageApi.getLayoutBenchmarkImageObjectUrl.mockResolvedValue('blob:prepared-letter');
    lettersApi.getAdminLetters.mockResolvedValue({
      letters: [],
      pagination: {
        page: 1,
        limit: 100,
        total: 0,
        totalPages: 0,
      },
      stats: {},
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('keeps the scan primary while explaining the selected content-aware match', async () => {
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('970 Lexington Avenue, New York')).toBeInTheDocument();
    expect(screen.getByText(/970 Lexinglon Ave\s+New York/)).toBeInTheDocument();
    expect(screen.getByText(
      'One transcript line matched to multiple image lines',
    )).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reference transcript' })).toBeInTheDocument();
    expect(screen.getAllByText('Legacy-confirmed transcript')).toHaveLength(2);
    expect(screen.queryByText('Authoritative transcript')).not.toBeInTheDocument();
    expect(screen.getByRole('group', {
      name: 'Transcript alignment for 005-19150813-L01-01',
    })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Layout comparison' })).toHaveAttribute(
      'href',
      '/admin/layout-benchmark',
    );
    expect(screen.getByText('Unassigned detection')).toBeInTheDocument();
    expect(screen.queryByText('Ignored detection')).not.toBeInTheDocument();
    expect(document.querySelectorAll(
      '.transcript-alignment-segment.is-selected',
    )).toHaveLength(2);
  });

  it('moves directly to the next uncertain transcript line', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    await screen.findByText('970 Lexington Avenue, New York');
    await user.click(screen.getByRole('button', { name: 'Next uncertain' }));

    expect(screen.getByText('My dear friend,')).toBeInTheDocument();
    expect(screen.getByText('Not located')).toBeInTheDocument();
    expect(screen.getByText('No image line was confidently located')).toBeInTheDocument();
    expect(screen.queryByText('Other plausible image matches')).not.toBeInTheDocument();
  });

  it('opens the exact production page in geometry-repair mode for an unlocated line', async () => {
    const user = userEvent.setup();
    lettersApi.getAdminLetters.mockResolvedValueOnce({
      letters: [{ id: 'production-letter-id' }],
      pagination: {
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
      },
      stats: {},
    });
    lettersApi.getAdminLetterById.mockResolvedValueOnce({
      id: 'production-letter-id',
      images: [{
        id: 'cover',
        type: 'cover',
        originalFilename: '005-cover.jpg',
        imageUrl: '/cover.jpg',
      }, {
        id: 'letter-page',
        type: 'letter',
        pageNumber: 1,
        originalFilename: '005-19150813-L01-01.jpg',
        imageUrl: '/letter.jpg',
      }],
    });
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    await screen.findByText('970 Lexington Avenue, New York');
    expect(screen.queryByRole('link', {
      name: 'Repair geometry',
    })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next uncertain' }));

    const repairLink = await screen.findByRole('link', {
      name: 'Repair geometry',
    });
    const href = repairLink.getAttribute('href');
    expect(href).not.toBeNull();
    const url = new URL(href!, 'http://localhost');
    expect(url.pathname).toBe('/admin/letters/production-letter-id');
    expect(url.searchParams.get('repairGeometry')).toBe('1');
    expect(url.searchParams.get('repairPageIndex')).toBe('1');
    expect(url.searchParams.get('repairPageFilename')).toBe(
      '005-19150813-L01-01.jpg',
    );
    expect(url.searchParams.get('repairText')).toBe('My dear friend,');
    expect(url.searchParams.has('mappingText')).toBe(false);
    expect(url.searchParams.get('repairIntent')).toContain(
      '005-19150813-L01-01:mapping-two',
    );
    expect(lettersApi.getAdminLetters).toHaveBeenCalledWith({
      collection: '005',
      page: 1,
      limit: 100,
    });
  });

  it('links only to the letter list when the artifact has no unique production match', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    await screen.findByText('970 Lexington Avenue, New York');
    await user.click(screen.getByRole('button', { name: 'Next uncertain' }));

    const fallbackLink = await screen.findByRole('link', {
      name: 'Find production letter',
    });
    expect(fallbackLink).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('link', {
      name: 'Repair geometry',
    })).not.toBeInTheDocument();
  });

  it('records a correct judgment with the candidate segment IDs and advances', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await screen.findByText('970 Lexington Avenue, New York');

    await user.click(screen.getByRole('button', { name: 'Correct' }));

    await waitFor(() => {
      expect(alignmentApi.putTranscriptAlignmentReview).toHaveBeenCalledWith(
        'mccatmus-dp-v1',
        '005-19150813-L01-01',
        'mapping-one',
        expect.objectContaining({
          expectedArtifactSha256: 'artifact',
          verdict: 'correct',
          correctSegmentIds: ['segment-a', 'segment-b'],
          failureModes: [],
          repairActions: 0,
          activeSeconds: expect.any(Number),
        }),
      );
    });
    expect(screen.getByText('My dear friend,')).toBeInTheDocument();
    expect(screen.getByText('1 / 2 judged')).toBeInTheDocument();
  });

  it('adds active review time to a previously saved judgment', async () => {
    const user = userEvent.setup();
    const reviewedPage = structuredClone(PAGE);
    reviewedPage.items = [reviewedPage.items[0]];
    reviewedPage.items[0].review = {
      verdict: 'unsure',
      correctSegmentIds: [],
      failureModes: [],
      activeSeconds: 7,
      repairActions: 0,
      updatedAt: '2026-07-29T00:00:00.000Z',
    };
    reviewedPage.summary.mappingCount = 1;
    reviewedPage.summary.reviewProgress = {
      reviewedCount: 1,
      totalCount: 1,
      percent: 100,
    };
    alignmentApi.getTranscriptAlignmentPage.mockResolvedValueOnce(reviewedPage);
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await screen.findByText('970 Lexington Avenue, New York');

    await user.click(screen.getByRole('button', { name: 'Correct' }));

    await waitFor(() => {
      expect(alignmentApi.putTranscriptAlignmentReview).toHaveBeenCalledWith(
        'mccatmus-dp-v1',
        '005-19150813-L01-01',
        'mapping-one',
        expect.objectContaining({
          activeSeconds: expect.any(Number),
        }),
      );
    });
    const submitted = alignmentApi.putTranscriptAlignmentReview.mock.calls[0]?.[3] as {
      activeSeconds: number;
    };
    expect(submitted.activeSeconds).toBeGreaterThanOrEqual(7);
  });

  it('uses a compact correction step before saving a wrong judgment', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await screen.findByText('970 Lexington Avenue, New York');

    await user.click(screen.getByRole('button', { name: 'Wrong' }));

    expect(alignmentApi.putTranscriptAlignmentReview).not.toHaveBeenCalled();
    const correctionInstructions = screen.getByText(
      'Show the correct location',
    ).parentElement;
    expect(correctionInstructions).toHaveTextContent(
      'Select up to 12 image lines',
    );
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', {
      name: /Select Detected image line 1.*corrected geometry/i,
    }));
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => {
      expect(alignmentApi.putTranscriptAlignmentReview).toHaveBeenCalledWith(
        'mccatmus-dp-v1',
        '005-19150813-L01-01',
        'mapping-one',
        expect.objectContaining({
          expectedArtifactSha256: 'artifact',
          verdict: 'incorrect',
          correctSegmentIds: ['segment-a'],
          failureModes: ['split'],
          repairActions: 1,
        }),
      );
    });
  });

  it('allows Not on page only when it changes the candidate geometry', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await screen.findByText('970 Lexington Avenue, New York');

    await user.click(screen.getByRole('button', { name: 'Next uncertain' }));
    await user.click(screen.getByRole('button', { name: 'Wrong' }));

    expect(screen.getByRole('button', { name: 'Not on page' })).toBeDisabled();
    expect(screen.getByText(
      'Visible text without a usable outline? Choose No detected line. If the text is absent, cancel and mark it Correct.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No detected line' })).toBeEnabled();

    await user.click(screen.getByRole('button', {
      name: /Select Detected image line 1.*corrected geometry/i,
    }));
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled();
  });

  it('records visible text with no Kraken polygon as an explicit missed line', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await screen.findByText('970 Lexington Avenue, New York');

    await user.click(screen.getByRole('button', { name: 'Next uncertain' }));
    await user.click(screen.getByRole('button', { name: 'Wrong' }));
    await user.click(screen.getByRole('button', { name: 'No detected line' }));

    await waitFor(() => {
      expect(alignmentApi.putTranscriptAlignmentReview).toHaveBeenCalledWith(
        'mccatmus-dp-v1',
        '005-19150813-L01-01',
        'mapping-two',
        expect.objectContaining({
          expectedArtifactSha256: 'artifact',
          verdict: 'incorrect',
          correctSegmentIds: [],
          failureModes: ['missed-line'],
          repairActions: 1,
        }),
      );
    });
  });

  it('keeps Not on page distinct from a missing Kraken detection', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await screen.findByText('970 Lexington Avenue, New York');

    await user.click(screen.getByRole('button', { name: 'Wrong' }));
    await user.click(screen.getByRole('button', { name: 'Missed line' }));
    await user.click(screen.getByRole('button', { name: 'Not on page' }));

    await waitFor(() => {
      expect(alignmentApi.putTranscriptAlignmentReview).toHaveBeenCalled();
    });
    const submitted = alignmentApi.putTranscriptAlignmentReview.mock.calls[0]?.[3] as {
      correctSegmentIds: string[];
      failureModes: TranscriptAlignmentFailureMode[];
    };
    expect(submitted.correctSegmentIds).toEqual([]);
    expect(submitted.failureModes).toContain('split');
    expect(submitted.failureModes).not.toContain('missed-line');
  });

  it('keeps the current item visible when the artifact changed on disk', async () => {
    const user = userEvent.setup();
    alignmentApi.putTranscriptAlignmentReview.mockRejectedValueOnce(
      new ApiError(409, 'Artifact changed', {
        code: 'ALIGNMENT_ARTIFACT_CHANGED',
      }),
    );
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await screen.findByText('970 Lexington Avenue, New York');

    await user.click(screen.getByRole('button', { name: 'Correct' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This experiment changed. Reload the page before saving this judgment.',
    );
    expect(screen.getByText('970 Lexington Avenue, New York')).toBeInTheDocument();
    expect(screen.queryByText('My dear friend,')).not.toBeInTheDocument();
    expect(alignmentApi.putTranscriptAlignmentReview).toHaveBeenCalledTimes(1);
  });

  it('shows enough run identity to distinguish experiments with the same friendly name', async () => {
    const secondIndex = structuredClone(RUN_INDEX);
    secondIndex.runs = [{
      ...structuredClone(RUN_INDEX.runs[0]),
      runId: 'mccatmus-flow-aware-v2-20260730',
    }, {
      ...structuredClone(RUN_INDEX.runs[0]),
      runId: 'mccatmus-flow-aware-v2b-20260730',
      createdAt: '2026-07-29T01:30:00.000Z',
    }];
    alignmentApi.getTranscriptAlignmentIndex.mockResolvedValueOnce(secondIndex);
    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    const experiment = await screen.findByRole('combobox', {
      name: 'Alignment experiment',
    });
    const labels = Array.from(experiment.querySelectorAll('option'))
      .map((option) => option.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('mccatmus…v2-20260730');
    expect(labels[1]).toContain('mccatmus…v2b-20260730');
    expect(new Set(labels).size).toBe(2);
  });

  it('shows standalone editorial markers as unresolved placeholders', async () => {
    const placeholderPage = structuredClone(PAGE);
    const placeholderItem = placeholderPage.items[1];
    if (!placeholderItem) throw new Error('Expected placeholder fixture item');
    placeholderItem.transcriptText = '[illegible]';
    placeholderPage.items = [placeholderItem];
    placeholderPage.summary = {
      ...placeholderPage.summary,
      mappingCount: 1,
      statusCounts: { accepted: 0, ambiguous: 0, unlocated: 1 },
      reviewProgress: {
        reviewedCount: 0,
        totalCount: 1,
        percent: 0,
      },
    };
    alignmentApi.getTranscriptAlignmentPage.mockResolvedValueOnce(placeholderPage);

    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Unresolved placeholder')).toBeInTheDocument();
    expect(screen.getByText(
      'No transcribed wording is available yet, so this line cannot be connected by text alone.',
    )).toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: 'Kraken clue (not verified wording)',
    })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Placeholder state' })).toBeInTheDocument();
    expect(screen.queryByText('Why these pieces are connected')).not.toBeInTheDocument();
    expect(screen.queryByText('Other plausible image matches')).not.toBeInTheDocument();
  });

  it('restores saved corrected evidence and labels the algorithm proposal as rejected', async () => {
    const reviewedPage = structuredClone(PAGE);
    const reviewedItem = reviewedPage.items[0];
    if (!reviewedItem) throw new Error('Expected reviewed fixture item');
    reviewedItem.mapping.operation = 'match';
    reviewedItem.mapping.segmentIds = ['segment-a'];
    reviewedItem.review = {
      verdict: 'incorrect',
      correctSegmentIds: ['segment-b'],
      failureModes: ['wrong-line'],
      activeSeconds: 4,
      repairActions: 2,
      updatedAt: '2026-07-30T00:00:00.000Z',
    };
    reviewedPage.items = [reviewedItem];
    alignmentApi.getTranscriptAlignmentPage.mockResolvedValueOnce(reviewedPage);

    const { container } = render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Saved correction' })).toBeInTheDocument();
    const savedCorrection = screen.getByRole('heading', { name: 'Saved correction' })
      .closest('section');
    expect(savedCorrection).toHaveTextContent('New York');
    const rejectedProposal = screen.getByRole('heading', {
      name: 'Rejected algorithm proposal',
    }).closest('section');
    expect(rejectedProposal).toHaveTextContent('970 Lexinglon Ave');
    expect(container.querySelector(
      '.transcript-alignment-segment.is-saved-correction [data-segment-id="segment-b"]',
    )).toBeInTheDocument();
    expect(container.querySelector(
      '.transcript-alignment-segment.is-rejected-proposal [data-segment-id="segment-a"]',
    )).toBeInTheDocument();
    expect(screen.getByText('Rejected proposal')).toBeInTheDocument();
  });

  it('shows every transcript line sharing an outline and switches only by explicit choice', async () => {
    const user = userEvent.setup();
    const sharedPage = structuredClone(PAGE);
    const secondItem = sharedPage.items[1];
    if (!secondItem) throw new Error('Expected shared fixture item');
    secondItem.mapping = {
      status: 'ambiguous',
      operation: 'merge',
      segmentIds: ['segment-a'],
      similarity: 0.6,
      confidence: 0.5,
      alternatives: [],
    };
    alignmentApi.getTranscriptAlignmentPage.mockResolvedValueOnce(sharedPage);

    render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );

    const connectedLines = await screen.findByRole('list', {
      name: 'Connected transcript lines',
    });
    const firstLine = within(connectedLines).getByRole('button', {
      name: /Line 1 970 Lexington Avenue, New York/i,
    });
    const secondLine = within(connectedLines).getByRole('button', {
      name: /Line 2 My dear friend/i,
    });
    expect(firstLine).toHaveAttribute('aria-pressed', 'true');
    expect(secondLine).toHaveAttribute('aria-pressed', 'false');

    await user.click(secondLine);

    expect(screen.getByText('Transcript line 2')).toBeInTheDocument();
    expect(within(screen.getByRole('list', {
      name: 'Connected transcript lines',
    })).getByRole('button', {
      name: /Line 2 My dear friend/i,
    })).toHaveAttribute('aria-pressed', 'true');
  });

  it('releases the private prepared-image object URL when leaving the page', async () => {
    const { unmount } = render(
      <MemoryRouter>
        <TranscriptAlignmentPage />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(imageApi.getLayoutBenchmarkImageObjectUrl).toHaveBeenCalled();
    });

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:prepared-letter');
  });
});
