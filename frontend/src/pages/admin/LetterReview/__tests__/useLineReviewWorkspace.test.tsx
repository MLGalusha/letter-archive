import {
  act,
  renderHook,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  Letter,
  LetterImage,
} from '../../../../types/Letter';
import type { AutoSaveData } from '../useAutoSave';
import type { LetterReviewVisit } from '../useLetterReviewVisit';
import {
  lineReviewRepairIntentFromSearch,
  searchAfterLineReviewRepairConsumption,
  type LineReviewRepairIntent,
  useLineReviewWorkspace,
} from '../useLineReviewWorkspace';

const { getAdminLetterByIdMock } = vi.hoisted(() => ({
  getAdminLetterByIdMock: vi.fn(),
}));

vi.mock('../../../../api/letters', () => ({
  getAdminLetterById: getAdminLetterByIdMock,
}));

function makeImage(
  id: string,
  originalFilename: string,
  overrides: Partial<LetterImage> = {},
): LetterImage {
  return {
    id,
    type: 'letter',
    pageNumber: 1,
    imageUrl: `/${id}.jpg`,
    originalFilename,
    segmentTrustState: 'trusted',
    lineSegments: [],
    ...overrides,
  };
}

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-a',
    title: 'Letter A',
    primarySourceRevision: 3,
    images: [
      makeImage('a-page-1', 'a-01.jpg'),
      makeImage('a-page-2', 'a-02.jpg', { pageNumber: 2 }),
    ],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Raw A transcript' }],
      fullText: 'Raw A transcript',
      verified: false,
    },
    metadata: { verified: false },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EDITED',
    metadataContentStatus: 'EDITED',
    extraContentStatus: 'EMPTY',
    createdAt: '2026-07-24T12:00:00.000Z',
    flagged: false,
    ...overrides,
  };
}

function makeEligibleLetter(overrides: Partial<Letter> = {}): Letter {
  return makeLetter({
    images: [
      makeImage('a-page-1', 'a-01.jpg', {
        segmentTrustState: 'unverified',
        lineSegments: [{
          line: 1,
          baseline: [[0, 9], [10, 9]],
          bbox: [0, 0, 10, 10],
          ocrText: 'Raw A transcript',
        }],
      }),
    ],
    ...overrides,
  });
}

function visit(
  letterId: string,
  active: { current: boolean },
): LetterReviewVisit {
  return {
    letterId,
    isActive: () => active.current,
  };
}

interface HookProps {
  currentVisit: LetterReviewVisit;
  letter: Letter | null;
  editorRef: { current: HTMLDivElement | null };
  isTranscriptEditing: boolean;
  lineReviewBlocked: boolean;
  repairIntent?: LineReviewRepairIntent | null;
  onRepairIntentConsumed?: (token: string) => void;
  onTranscriptChange: (text: string) => void;
  onAutoSave: (data: AutoSaveData) => void;
}

const useWorkspace = (props: HookProps) => useLineReviewWorkspace({
  visit: props.currentVisit,
  letter: props.letter,
  editorRef: props.editorRef,
  isTranscriptEditing: props.isTranscriptEditing,
  lineReviewBlocked: props.lineReviewBlocked,
  repairIntent: props.repairIntent,
  onRepairIntentConsumed: props.onRepairIntentConsumed,
  onTranscriptChange: props.onTranscriptChange,
  onAutoSave: props.onAutoSave,
});

function baseProps(
  currentVisit: LetterReviewVisit,
  overrides: Partial<HookProps> = {},
): HookProps {
  return {
    currentVisit,
    letter: makeLetter(),
    editorRef: { current: null },
    isTranscriptEditing: false,
    lineReviewBlocked: false,
    onTranscriptChange: vi.fn(),
    onAutoSave: vi.fn(),
    ...overrides,
  };
}

function selectText(
  container: HTMLElement,
  node: Text,
  start: number,
  end: number,
) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  expect(container.contains(range.commonAncestorContainer)).toBe(true);
}

describe('line-review repair query contract', () => {
  it('parses a complete repair handoff and rejects incomplete requests', () => {
    const params = new URLSearchParams({
      repairGeometry: '1',
      repairIntent: 'artifact:page:item',
      repairPageIndex: '2',
      repairPageFilename: '005-19150813-L01-01.jpg',
      repairText: 'My dear Sadie,',
    });

    expect(lineReviewRepairIntentFromSearch(`?${params}`)).toEqual({
      token: 'artifact:page:item',
      pageIndex: 2,
      originalFilename: '005-19150813-L01-01.jpg',
      repairText: 'My dear Sadie,',
    });
    expect(lineReviewRepairIntentFromSearch(
      '?repairGeometry=1&repairIntent=missing-page',
    )).toBeNull();
  });

  it('removes only the matching one-shot repair request', () => {
    const search = [
      'repairGeometry=1',
      'repairIntent=artifact%3Apage%3Aitem',
      'repairPageIndex=2',
      'repairPageFilename=page.jpg',
      'repairText=My+dear+Sadie',
      'returnTo=alignment',
    ].join('&');

    expect(searchAfterLineReviewRepairConsumption(
      `?${search}`,
      'artifact:page:item',
    )).toBe('returnTo=alignment');
    expect(searchAfterLineReviewRepairConsumption(
      `?${search}`,
      'different-item',
    )).toBeNull();
  });
});

describe('useLineReviewWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('resets synchronously across A to B to fresh A and rejects captured A controls', () => {
    const firstAActive = { current: true };
    const bActive = { current: false };
    const freshAActive = { current: false };
    const visits = {
      firstA: visit('letter-a', firstAActive),
      b: visit('letter-b', bActive),
      freshA: visit('letter-a', freshAActive),
    };
    const onTranscriptChange = vi.fn();
    const onAutoSave = vi.fn();
    const firstLetter = makeLetter();
    const editor = document.createElement('div');
    const editorText = document.createTextNode('A repair intent');
    editor.append(editorText);
    document.body.append(editor);
    const initialProps = baseProps(visits.firstA, {
      letter: firstLetter,
      editorRef: { current: editor },
      onTranscriptChange,
      onAutoSave,
    });
    const renderHistory: Array<{
      visit: LetterReviewVisit;
      active: boolean;
      pageIndex: number;
      debugMode: boolean;
      selectedText: string;
      repairText: string | undefined;
    }> = [];
    const useObservedWorkspace = (props: HookProps) => {
      const workspace = useWorkspace(props);
      renderHistory.push({
        visit: props.currentVisit,
        active: workspace.active,
        pageIndex: workspace.modeProps.initialPageIndex,
        debugMode: workspace.headerControls.debugMode,
        selectedText: workspace.selectedText,
        repairText: workspace.modeProps.repairText,
      });
      return workspace;
    };
    const { result, rerender } = renderHook(useObservedWorkspace, {
      initialProps,
    });

    act(() => {
      result.current.viewerProps.onPageChange(1);
    });
    act(() => {
      selectText(editor, editorText, 2, 9);
    });
    expect(result.current.selectedText).toBe('repair');
    const capturedClosedA = {
      imageClick: result.current.viewerProps.onImageClick,
      reviewSegments: result.current.repairControls.reviewSegments,
      repairSelectedText: result.current.repairControls.repairSelectedText,
    };
    act(() => {
      result.current.repairControls.repairSelectedText();
    });
    act(() => {
      result.current.modeProps.onDebugModeChange(true);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(true);
    expect(result.current.modeProps.repairText).toBe('repair');
    expect(result.current.modeProps.initialPageIndex).toBe(1);
    expect(result.current.currentFilename).toBe('a-02.jpg');
    expect(result.current.headerControls.debugMode).toBe(true);

    const reloadA = vi.fn();
    act(() => {
      result.current.modeRef({
        saveCurrentLine: vi.fn(),
        flushPendingChanges: vi.fn(async () => true),
        hasPendingChanges: vi.fn(() => false),
        reloadSegments: reloadA,
        isLoading: true,
      });
    });
    expect(result.current.headerControls.reloadDisabled).toBe(true);

    const capturedA = {
      exit: result.current.modeProps.onExit,
      setDebug: result.current.modeProps.onDebugModeChange,
      toggleDebug: result.current.headerControls.toggleDebugMode,
      reloadSegments: result.current.headerControls.reloadSegments,
      modeRef: result.current.modeRef,
      pageChange: result.current.viewerProps.onPageChange,
      transcriptChange: result.current.modeProps.onTranscriptChange,
      autoSave: result.current.modeProps.onAutoSave,
    };

    const letterB = makeLetter({
      id: 'letter-b',
      title: 'Letter B',
      images: [
        makeImage('b-page-1', 'b-01.jpg'),
        makeImage('b-page-2', 'b-02.jpg', { pageNumber: 2 }),
      ],
    });
    firstAActive.current = false;
    bActive.current = true;
    const firstBRender = renderHistory.length;
    rerender({
      ...initialProps,
      currentVisit: visits.b,
      letter: letterB,
    });

    expect(renderHistory[firstBRender]).toEqual({
      visit: visits.b,
      active: false,
      pageIndex: 0,
      debugMode: false,
      selectedText: '',
      repairText: undefined,
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.initialPageIndex).toBe(0);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();
    expect(result.current.currentFilename).toBe('b-01.jpg');
    expect(result.current.selectedText).toBe('');
    expect(result.current.headerControls.debugMode).toBe(false);
    expect(result.current.headerControls.reloadDisabled).toBe(false);

    act(() => {
      result.current.viewerProps.onPageChange(1);
      result.current.viewerProps.onImageClick(1);
    });
    act(() => {
      result.current.modeProps.onDebugModeChange(true);
    });
    expect(result.current.currentFilename).toBe('b-02.jpg');

    const reloadB = vi.fn();
    act(() => {
      result.current.modeRef({
        saveCurrentLine: vi.fn(),
        flushPendingChanges: vi.fn(async () => true),
        hasPendingChanges: vi.fn(() => false),
        reloadSegments: reloadB,
        isLoading: false,
      });
    });

    act(() => {
      capturedA.exit();
      capturedA.setDebug(false);
      capturedA.toggleDebug();
      capturedA.reloadSegments();
      capturedA.modeRef({
        saveCurrentLine: vi.fn(),
        flushPendingChanges: vi.fn(async () => true),
        hasPendingChanges: vi.fn(() => false),
        reloadSegments: vi.fn(),
        isLoading: false,
      });
      capturedA.pageChange(0);
      capturedClosedA.imageClick(0);
      capturedClosedA.reviewSegments();
      capturedClosedA.repairSelectedText();
      capturedA.transcriptChange('stale A');
      capturedA.autoSave({ transcriptionText: 'stale A' });
    });

    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.initialPageIndex).toBe(1);
    expect(result.current.currentFilename).toBe('b-02.jpg');
    expect(result.current.headerControls.debugMode).toBe(true);
    expect(onTranscriptChange).not.toHaveBeenCalled();
    expect(onAutoSave).not.toHaveBeenCalled();
    expect(getAdminLetterByIdMock).not.toHaveBeenCalled();
    expect(reloadA).not.toHaveBeenCalled();
    expect(reloadB).not.toHaveBeenCalled();

    act(() => {
      result.current.headerControls.reloadSegments();
    });
    expect(reloadB).toHaveBeenCalledOnce();

    bActive.current = false;
    freshAActive.current = true;
    rerender({
      ...initialProps,
      currentVisit: visits.freshA,
      letter: makeLetter(),
    });

    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.initialPageIndex).toBe(0);
    expect(result.current.currentFilename).toBe('a-01.jpg');
    expect(result.current.headerControls.debugMode).toBe(false);
    expect(result.current.selectedText).toBe('');

    act(() => {
      capturedClosedA.imageClick(1);
      capturedClosedA.reviewSegments();
      capturedClosedA.repairSelectedText();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();
    expect(result.current.modeProps.initialPageIndex).toBe(0);

    act(() => {
      result.current.viewerProps.onPageChange(1);
      result.current.viewerProps.onImageClick(1);
    });
    act(() => {
      result.current.modeProps.onDebugModeChange(true);
    });
    const reloadFreshA = vi.fn();
    act(() => {
      result.current.modeRef({
        saveCurrentLine: vi.fn(),
        flushPendingChanges: vi.fn(async () => true),
        hasPendingChanges: vi.fn(() => false),
        reloadSegments: reloadFreshA,
        isLoading: false,
      });
    });

    act(() => {
      capturedA.exit();
      capturedA.setDebug(false);
      capturedA.toggleDebug();
      capturedA.reloadSegments();
      capturedA.modeRef({
        saveCurrentLine: vi.fn(),
        flushPendingChanges: vi.fn(async () => true),
        hasPendingChanges: vi.fn(() => false),
        reloadSegments: vi.fn(),
        isLoading: true,
      });
      capturedA.pageChange(0);
      capturedA.transcriptChange('stale fresh A');
      capturedA.autoSave({ transcriptionText: 'stale fresh A' });
    });

    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();
    expect(result.current.modeProps.initialPageIndex).toBe(1);
    expect(result.current.currentFilename).toBe('a-02.jpg');
    expect(result.current.headerControls.debugMode).toBe(true);
    expect(onTranscriptChange).not.toHaveBeenCalled();
    expect(onAutoSave).not.toHaveBeenCalled();
    expect(getAdminLetterByIdMock).not.toHaveBeenCalled();
    expect(reloadA).not.toHaveBeenCalled();
    expect(reloadFreshA).not.toHaveBeenCalled();

    act(() => {
      result.current.headerControls.reloadSegments();
    });
    expect(reloadFreshA).toHaveBeenCalledOnce();
  });

  it('keeps stored segments closed until an explicit entry action', () => {
    const firstAActive = { current: true };
    const freshAActive = { current: false };
    const visits = {
      firstA: visit('letter-a', firstAActive),
      freshA: visit('letter-a', freshAActive),
    };
    const initialProps = baseProps(visits.firstA, {
      letter: null,
    });
    const { result, rerender } = renderHook(useWorkspace, {
      initialProps,
    });

    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();

    rerender({
      ...initialProps,
      letter: makeEligibleLetter(),
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();

    rerender({
      ...initialProps,
      letter: makeEligibleLetter({
        title: 'Refreshed Letter A',
        primarySourceRevision: 4,
      }),
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();

    firstAActive.current = false;
    freshAActive.current = true;
    rerender({
      ...initialProps,
      currentVisit: visits.freshA,
      letter: makeEligibleLetter(),
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();

    act(() => {
      result.current.viewerProps.onImageClick(0);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();
  });

  it('fails closed until the active mode handle can report and flush pending work', async () => {
    const active = { current: true };
    const currentVisit = visit('letter-a', active);
    const { result } = renderHook(useWorkspace, {
      initialProps: baseProps(currentVisit),
    });

    act(() => {
      result.current.viewerProps.onImageClick(0);
    });
    expect(result.current.active).toBe(true);
    expect(
      result.current.navigationControls.hasPendingChanges(),
    ).toBe(true);
    await expect(
      result.current.navigationControls.flushPendingChanges(),
    ).resolves.toBe(false);

    const flushPendingChanges = vi.fn(async () => true);
    act(() => {
      result.current.modeRef({
        saveCurrentLine: vi.fn(),
        flushPendingChanges,
        hasPendingChanges: vi.fn(() => false),
        reloadSegments: vi.fn(),
        isLoading: false,
      });
    });

    expect(
      result.current.navigationControls.hasPendingChanges(),
    ).toBe(false);
    await expect(
      result.current.navigationControls.flushPendingChanges(),
    ).resolves.toBe(true);
    expect(flushPendingChanges).toHaveBeenCalledTimes(1);
  });

  it('consumes a repair intent once and opens segment-first on the exact filename', async () => {
    const currentVisit = visit('letter-a', { current: true });
    const onRepairIntentConsumed = vi.fn();
    const repairIntent: LineReviewRepairIntent = {
      token: 'artifact:page:item',
      pageIndex: 0,
      originalFilename: 'a-02.jpg',
      repairText: '  My dear Sadie,  ',
    };
    const initialProps = baseProps(currentVisit, {
      letter: null,
      repairIntent,
      onRepairIntentConsumed,
    });
    const { result, rerender } = renderHook(useWorkspace, {
      initialProps,
    });

    expect(result.current.active).toBe(false);
    expect(onRepairIntentConsumed).not.toHaveBeenCalled();

    rerender({
      ...initialProps,
      letter: makeLetter({
        images: [
          makeImage('cover', 'cover.jpg', { type: 'cover' }),
          makeImage('a-page-1', 'a-01.jpg'),
          makeImage('a-page-2', 'a-02.jpg', { pageNumber: 2 }),
        ],
      }),
    });

    await waitFor(() => {
      expect(result.current.active).toBe(true);
    });
    expect(onRepairIntentConsumed).toHaveBeenCalledOnce();
    expect(onRepairIntentConsumed).toHaveBeenCalledWith(
      'artifact:page:item',
    );
    expect(result.current.modeProps.fullViewport).toBe(true);
    expect(result.current.modeProps.initialPageIndex).toBe(2);
    expect(result.current.currentFilename).toBe('a-02.jpg');
    expect(result.current.modeProps.repairText).toBe('My dear Sadie,');

    act(() => {
      result.current.modeProps.onExit();
    });
    expect(result.current.active).toBe(false);

    rerender({
      ...initialProps,
      letter: makeLetter({
        title: 'Refreshed Letter A',
        images: [
          makeImage('cover', 'cover.jpg', { type: 'cover' }),
          makeImage('a-page-1', 'a-01.jpg'),
          makeImage('a-page-2', 'a-02.jpg', { pageNumber: 2 }),
        ],
      }),
    });
    expect(result.current.active).toBe(false);
    expect(onRepairIntentConsumed).toHaveBeenCalledOnce();
  });

  it('consumes but does not open a repair intent whose filename is no longer exact', async () => {
    const currentVisit = visit('letter-a', { current: true });
    const onRepairIntentConsumed = vi.fn();
    const props = baseProps(currentVisit, {
      repairIntent: {
        token: 'stale-artifact-page',
        pageIndex: 1,
        originalFilename: 'missing-page.jpg',
        repairText: 'Do not map this to the wrong scan.',
      },
      onRepairIntentConsumed,
    });
    const { result } = renderHook(useWorkspace, {
      initialProps: props,
    });

    await waitFor(() => {
      expect(onRepairIntentConsumed).toHaveBeenCalledWith(
        'stale-artifact-page',
      );
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();
    expect(result.current.modeProps.initialPageIndex).toBe(0);
  });

  it('owns transcript selection and maps only current editable editor text', () => {
    const firstActive = { current: true };
    const freshActive = { current: false };
    const firstVisit = visit('letter-a', firstActive);
    const freshVisit = visit('letter-a', freshActive);
    const editor = document.createElement('div');
    const editorText = document.createTextNode('Alpha beta gamma');
    editor.append(editorText);
    const outside = document.createElement('div');
    const outsideText = document.createTextNode('Outside text');
    outside.append(outsideText);
    document.body.append(editor, outside);
    const editorRef = { current: editor };
    const initialProps = baseProps(firstVisit, { editorRef });
    const { result, rerender } = renderHook(useWorkspace, {
      initialProps,
    });

    act(() => {
      selectText(editor, editorText, 5, 10);
    });
    expect(result.current.selectedText).toBe('beta');

    act(() => {
      result.current.repairControls.repairSelectedText();
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(true);
    expect(result.current.modeProps.repairText).toBe('beta');

    act(() => {
      result.current.modeProps.onExit();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();

    act(() => {
      result.current.viewerProps.onImageClick(0);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();

    act(() => {
      result.current.modeProps.onExit();
      selectText(outside, outsideText, 0, 7);
    });
    expect(result.current.selectedText).toBe('');
    act(() => {
      result.current.repairControls.repairSelectedText();
    });
    expect(result.current.active).toBe(false);

    act(() => {
      selectText(editor, editorText, 6, 10);
    });
    expect(result.current.selectedText).toBe('beta');

    rerender({
      ...initialProps,
      letter: makeLetter({ transcriptStatus: 'VERIFIED' }),
    });
    expect(result.current.selectedText).toBe('');

    rerender({
      ...initialProps,
      letter: makeLetter({ transcriptStatus: 'VERIFIED' }),
      isTranscriptEditing: true,
    });
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(result.current.selectedText).toBe('beta');

    firstActive.current = false;
    freshActive.current = true;
    rerender({
      ...initialProps,
      currentVisit: freshVisit,
      letter: makeLetter({ transcriptStatus: 'VERIFIED' }),
      isTranscriptEditing: true,
    });
    expect(result.current.selectedText).toBe('');
  });

  it('preserves entry gates and guards Line Review adapters by visit', () => {
    const firstActive = { current: true };
    const freshActive = { current: false };
    const firstVisit = visit('letter-a', firstActive);
    const freshVisit = visit('letter-b', freshActive);
    const onTranscriptChange = vi.fn();
    const onAutoSave = vi.fn();
    const initialProps = baseProps(firstVisit, {
      onTranscriptChange,
      onAutoSave,
    });
    const { result, rerender } = renderHook(useWorkspace, {
      initialProps,
    });

    const photo = makeLetter({
      images: [{
        id: 'photo',
        type: 'photo',
        imageUrl: '/photo.jpg',
        originalFilename: 'photo.jpg',
      }],
    });
    rerender({ ...initialProps, letter: photo });
    act(() => {
      result.current.viewerProps.onImageClick(0);
    });
    expect(result.current.active).toBe(false);

    rerender({
      ...initialProps,
      isTranscriptEditing: true,
    });
    act(() => {
      result.current.viewerProps.onImageClick(1);
    });
    expect(result.current.active).toBe(false);

    rerender({
      ...initialProps,
      lineReviewBlocked: true,
    });
    act(() => {
      result.current.viewerProps.onImageClick(1);
    });
    expect(result.current.active).toBe(false);

    rerender(initialProps);
    act(() => {
      result.current.viewerProps.onImageClick(1);
    });
    act(() => {
      result.current.modeProps.onDebugModeChange(true);
      result.current.modeProps.onTranscriptChange('edited transcript');
      result.current.modeProps.onAutoSave({
        transcriptionText: 'edited transcript',
      });
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.initialPageIndex).toBe(1);
    expect(result.current.currentFilename).toBe('a-02.jpg');
    expect(onTranscriptChange).toHaveBeenCalledWith('edited transcript');
    expect(onAutoSave).toHaveBeenCalledWith({
      transcriptionText: 'edited transcript',
    });

    const capturedTranscriptChange =
      result.current.modeProps.onTranscriptChange;
    const capturedAutoSave = result.current.modeProps.onAutoSave;
    act(() => {
      result.current.modeProps.onExit();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.repairText).toBeUndefined();
    expect(result.current.modeProps.initialPageIndex).toBe(1);
    expect(result.current.headerControls.debugMode).toBe(true);

    firstActive.current = false;
    freshActive.current = true;
    rerender({
      ...initialProps,
      currentVisit: freshVisit,
      letter: makeLetter({
        id: 'letter-b',
        title: 'Letter B',
      }),
    });
    act(() => {
      capturedTranscriptChange('stale transcript');
      capturedAutoSave({ transcriptionText: 'stale transcript' });
    });

    expect(onTranscriptChange).toHaveBeenCalledTimes(1);
    expect(onAutoSave).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
  });
});
