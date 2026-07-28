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
import { useLineReviewWorkspace } from '../useLineReviewWorkspace';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

interface HookProps {
  currentVisit: LetterReviewVisit;
  letter: Letter | null;
  editorRef: { current: HTMLDivElement | null };
  isTranscriptEditing: boolean;
  lineReviewBlocked: boolean;
  tryAdoptLetter: (letter: Letter) => boolean;
  onTranscriptChange: (text: string) => void;
  onAutoSave: (data: AutoSaveData) => void;
}

const useWorkspace = (props: HookProps) => useLineReviewWorkspace({
  visit: props.currentVisit,
  letter: props.letter,
  editorRef: props.editorRef,
  isTranscriptEditing: props.isTranscriptEditing,
  lineReviewBlocked: props.lineReviewBlocked,
  tryAdoptLetter: props.tryAdoptLetter,
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
    tryAdoptLetter: vi.fn(() => true),
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
    const editorText = document.createTextNode('A mapping intent');
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
      mappingText: string | undefined;
    }> = [];
    const useObservedWorkspace = (props: HookProps) => {
      const workspace = useWorkspace(props);
      renderHistory.push({
        visit: props.currentVisit,
        active: workspace.active,
        pageIndex: workspace.modeProps.initialPageIndex,
        debugMode: workspace.headerControls.debugMode,
        selectedText: workspace.selectedText,
        mappingText: workspace.modeProps.mappingText,
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
    expect(result.current.selectedText).toBe('mapping');
    const capturedClosedA = {
      imageClick: result.current.viewerProps.onImageClick,
      reviewSegments: result.current.mappingControls.reviewSegments,
      mapSelectedText: result.current.mappingControls.mapSelectedText,
    };
    act(() => {
      result.current.mappingControls.mapSelectedText();
    });
    act(() => {
      result.current.modeProps.onDebugModeChange(true);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(true);
    expect(result.current.modeProps.mappingText).toBe('mapping');
    expect(result.current.modeProps.initialPageIndex).toBe(1);
    expect(result.current.currentFilename).toBe('a-02.jpg');
    expect(result.current.headerControls.debugMode).toBe(true);

    const reloadA = vi.fn();
    act(() => {
      result.current.modeRef({
        saveCurrentLine: vi.fn(),
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
      mappingComplete: result.current.modeProps.onMappingComplete,
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
      mappingText: undefined,
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.initialPageIndex).toBe(0);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();
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
        reloadSegments: vi.fn(),
        isLoading: false,
      });
      capturedA.pageChange(0);
      capturedClosedA.imageClick(0);
      capturedClosedA.reviewSegments();
      capturedClosedA.mapSelectedText();
      capturedA.mappingComplete();
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
      capturedClosedA.mapSelectedText();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();
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
        reloadSegments: vi.fn(),
        isLoading: true,
      });
      capturedA.pageChange(0);
      capturedA.mappingComplete();
      capturedA.transcriptChange('stale fresh A');
      capturedA.autoSave({ transcriptionText: 'stale fresh A' });
    });

    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();
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
    expect(result.current.modeProps.mappingText).toBeUndefined();

    rerender({
      ...initialProps,
      letter: makeEligibleLetter(),
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    rerender({
      ...initialProps,
      letter: makeEligibleLetter({
        title: 'Refreshed Letter A',
        primarySourceRevision: 4,
      }),
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    firstAActive.current = false;
    freshAActive.current = true;
    rerender({
      ...initialProps,
      currentVisit: visits.freshA,
      letter: makeEligibleLetter(),
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    act(() => {
      result.current.viewerProps.onImageClick(0);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();
  });

  it('refreshes and adopts the current letter after mapping, and catches refresh failures', async () => {
    const currentVisit = visit('letter-a', { current: true });
    const pending = deferred<Letter>();
    const updated = makeEligibleLetter({
      primarySourceRevision: 4,
    });
    const tryAdoptLetter = vi.fn(() => true);
    getAdminLetterByIdMock.mockReturnValueOnce(pending.promise);
    const props = baseProps(currentVisit, { tryAdoptLetter });
    const { result } = renderHook(useWorkspace, {
      initialProps: props,
    });

    act(() => {
      result.current.mappingControls.reviewSegments();
    });
    act(() => {
      result.current.modeProps.onMappingComplete();
    });

    expect(getAdminLetterByIdMock).toHaveBeenCalledWith('letter-a');
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(true);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    act(() => {
      result.current.modeProps.onExit();
    });
    expect(result.current.active).toBe(false);

    await act(async () => {
      pending.resolve(updated);
      await pending.promise;
    });
    expect(tryAdoptLetter).toHaveBeenCalledWith(updated);

    const refreshError = new Error('refresh failed');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    getAdminLetterByIdMock.mockRejectedValueOnce(refreshError);
    act(() => {
      result.current.mappingControls.reviewSegments();
    });
    act(() => {
      result.current.modeProps.onMappingComplete();
    });

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to refresh mapped segments:',
        refreshError,
      );
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(true);
  });

  it('fences same-visit entry callbacks and adopts only the latest mapping refresh', async () => {
    const currentVisit = visit('letter-a', { current: true });
    const editor = document.createElement('div');
    const editorText = document.createTextNode('First second');
    editor.append(editorText);
    document.body.append(editor);
    const tryAdoptLetter = vi.fn(() => true);
    const onTranscriptChange = vi.fn();
    const onAutoSave = vi.fn();
    const props = baseProps(currentVisit, {
      editorRef: { current: editor },
      tryAdoptLetter,
      onTranscriptChange,
      onAutoSave,
    });
    const { result } = renderHook(useWorkspace, {
      initialProps: props,
    });

    act(() => {
      selectText(editor, editorText, 0, 5);
    });
    act(() => {
      result.current.mappingControls.mapSelectedText();
    });
    const reloadFirstEntry = vi.fn();
    act(() => {
      result.current.modeRef({
        saveCurrentLine: vi.fn(),
        reloadSegments: reloadFirstEntry,
        isLoading: false,
      });
    });
    const staleEntry = {
      exit: result.current.modeProps.onExit,
      setDebug: result.current.modeProps.onDebugModeChange,
      toggleDebug: result.current.headerControls.toggleDebugMode,
      reloadSegments: result.current.headerControls.reloadSegments,
      modeRef: result.current.modeRef,
      mappingComplete: result.current.modeProps.onMappingComplete,
      transcriptChange: result.current.modeProps.onTranscriptChange,
      autoSave: result.current.modeProps.onAutoSave,
    };
    const firstEntryRefresh = deferred<Letter>();
    getAdminLetterByIdMock.mockReturnValueOnce(firstEntryRefresh.promise);
    act(() => {
      staleEntry.mappingComplete();
    });
    expect(getAdminLetterByIdMock).toHaveBeenCalledOnce();

    act(() => {
      staleEntry.exit();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    act(() => {
      selectText(editor, editorText, 6, 12);
    });
    act(() => {
      result.current.mappingControls.mapSelectedText();
    });
    act(() => {
      result.current.modeProps.onDebugModeChange(true);
    });
    const reloadSecondEntry = vi.fn();
    act(() => {
      result.current.modeRef({
        saveCurrentLine: vi.fn(),
        reloadSegments: reloadSecondEntry,
        isLoading: false,
      });
    });
    expect(result.current.modeProps.mappingText).toBe('second');

    await act(async () => {
      firstEntryRefresh.resolve(makeLetter({
        title: 'Superseded first-entry refresh',
        primarySourceRevision: 4,
      }));
      await firstEntryRefresh.promise;
    });
    expect(tryAdoptLetter).not.toHaveBeenCalled();
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.mappingText).toBe('second');
    expect(result.current.headerControls.debugMode).toBe(true);
    getAdminLetterByIdMock.mockClear();

    act(() => {
      staleEntry.exit();
      staleEntry.setDebug(false);
      staleEntry.toggleDebug();
      staleEntry.reloadSegments();
      staleEntry.modeRef({
        saveCurrentLine: vi.fn(),
        reloadSegments: vi.fn(),
        isLoading: true,
      });
      staleEntry.modeRef(null);
      staleEntry.mappingComplete();
      staleEntry.transcriptChange('stale first entry');
      staleEntry.autoSave({ transcriptionText: 'stale first entry' });
    });

    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.mappingText).toBe('second');
    expect(result.current.headerControls.debugMode).toBe(true);
    expect(reloadFirstEntry).not.toHaveBeenCalled();
    expect(reloadSecondEntry).not.toHaveBeenCalled();
    expect(onTranscriptChange).not.toHaveBeenCalled();
    expect(onAutoSave).not.toHaveBeenCalled();
    expect(getAdminLetterByIdMock).not.toHaveBeenCalled();

    act(() => {
      result.current.headerControls.reloadSegments();
    });
    expect(reloadFirstEntry).not.toHaveBeenCalled();
    expect(reloadSecondEntry).toHaveBeenCalledOnce();

    const olderRefresh = deferred<Letter>();
    const newerRefresh = deferred<Letter>();
    const olderLetter = makeLetter({
      title: 'Older mapping refresh',
      primarySourceRevision: 4,
    });
    const newerLetter = makeLetter({
      title: 'Newer mapping refresh',
      primarySourceRevision: 5,
    });
    getAdminLetterByIdMock
      .mockReturnValueOnce(olderRefresh.promise)
      .mockReturnValueOnce(newerRefresh.promise);
    const currentCompletion = result.current.modeProps.onMappingComplete;

    act(() => {
      currentCompletion();
      currentCompletion();
    });
    expect(getAdminLetterByIdMock).toHaveBeenCalledTimes(2);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    await act(async () => {
      newerRefresh.resolve(newerLetter);
      await newerRefresh.promise;
    });
    expect(tryAdoptLetter).toHaveBeenCalledTimes(1);
    expect(tryAdoptLetter).toHaveBeenLastCalledWith(newerLetter);

    await act(async () => {
      olderRefresh.resolve(olderLetter);
      await olderRefresh.promise;
    });
    expect(tryAdoptLetter).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['viewer image', 'image', false, undefined],
    ['Review action', 'review', true, undefined],
    ['mapping action', 'mapping', true, 'second'],
  ] as const)(
    'supersedes an exited mapping refresh when reopening through %s',
    async (
      _entryName,
      reopenKind,
      expectedFullViewport,
      expectedMappingText,
    ) => {
      const currentVisit = visit('letter-a', { current: true });
      const editor = document.createElement('div');
      const editorText = document.createTextNode('First second');
      editor.append(editorText);
      document.body.append(editor);
      const pending = deferred<Letter>();
      const tryAdoptLetter = vi.fn(() => true);
      getAdminLetterByIdMock.mockReturnValueOnce(pending.promise);
      const props = baseProps(currentVisit, {
        editorRef: { current: editor },
        tryAdoptLetter,
      });
      const { result } = renderHook(useWorkspace, {
        initialProps: props,
      });

      act(() => {
        selectText(editor, editorText, 6, 12);
        result.current.mappingControls.reviewSegments();
      });
      act(() => {
        result.current.modeProps.onMappingComplete();
        result.current.modeProps.onExit();
      });
      expect(getAdminLetterByIdMock).toHaveBeenCalledOnce();
      expect(result.current.active).toBe(false);

      act(() => {
        if (reopenKind === 'image') {
          result.current.viewerProps.onImageClick(1);
        } else if (reopenKind === 'review') {
          result.current.mappingControls.reviewSegments();
        } else {
          result.current.mappingControls.mapSelectedText();
        }
      });
      expect(result.current.active).toBe(true);
      expect(result.current.modeProps.fullViewport).toBe(
        expectedFullViewport,
      );
      expect(result.current.modeProps.mappingText).toBe(
        expectedMappingText,
      );

      await act(async () => {
        pending.resolve(makeLetter({
          title: 'Superseded exited-entry refresh',
          primarySourceRevision: 99,
        }));
        await pending.promise;
      });

      expect(tryAdoptLetter).not.toHaveBeenCalled();
      expect(result.current.active).toBe(true);
      expect(result.current.modeProps.fullViewport).toBe(
        expectedFullViewport,
      );
      expect(result.current.modeProps.mappingText).toBe(
        expectedMappingText,
      );
    },
  );

  it('keeps a late mapping refresh and an inactive captured completion inert', async () => {
    const firstAActive = { current: true };
    const bActive = { current: false };
    const freshAActive = { current: false };
    const visits = {
      firstA: visit('letter-a', firstAActive),
      b: visit('letter-b', bActive),
      freshA: visit('letter-a', freshAActive),
    };
    const pending = deferred<Letter>();
    getAdminLetterByIdMock.mockReturnValueOnce(pending.promise);
    const tryAdoptLetter = vi.fn(() => true);
    const initialProps = baseProps(visits.firstA, { tryAdoptLetter });
    const { result, rerender } = renderHook(useWorkspace, {
      initialProps,
    });

    act(() => {
      result.current.mappingControls.reviewSegments();
    });
    act(() => {
      result.current.modeProps.onMappingComplete();
    });
    const capturedCompletion = result.current.modeProps.onMappingComplete;
    expect(getAdminLetterByIdMock).toHaveBeenCalledTimes(1);

    firstAActive.current = false;
    bActive.current = true;
    rerender({
      ...initialProps,
      currentVisit: visits.b,
      letter: makeLetter({
        id: 'letter-b',
        title: 'Letter B',
      }),
    });
    bActive.current = false;
    freshAActive.current = true;
    rerender({
      ...initialProps,
      currentVisit: visits.freshA,
      letter: makeLetter(),
    });

    act(() => {
      capturedCompletion();
    });
    expect(getAdminLetterByIdMock).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);

    await act(async () => {
      pending.resolve(makeEligibleLetter({
        primarySourceRevision: 99,
      }));
      await pending.promise;
    });

    expect(tryAdoptLetter).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.initialPageIndex).toBe(0);
    expect(result.current.modeProps.mappingText).toBeUndefined();
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
      result.current.mappingControls.mapSelectedText();
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(true);
    expect(result.current.modeProps.mappingText).toBe('beta');

    act(() => {
      result.current.modeProps.onExit();
    });
    expect(result.current.active).toBe(false);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    act(() => {
      result.current.viewerProps.onImageClick(0);
    });
    expect(result.current.active).toBe(true);
    expect(result.current.modeProps.fullViewport).toBe(false);
    expect(result.current.modeProps.mappingText).toBeUndefined();

    act(() => {
      result.current.modeProps.onExit();
      selectText(outside, outsideText, 0, 7);
    });
    expect(result.current.selectedText).toBe('');
    act(() => {
      result.current.mappingControls.mapSelectedText();
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
    expect(result.current.modeProps.mappingText).toBeUndefined();
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
