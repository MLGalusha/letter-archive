import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { RefObject } from 'react';
import type { Letter } from '../../../types/Letter';
import { hasPrimaryTranscriptContent } from '../../../utils/letterContent';
import type {
  LineReviewModeHandle,
} from '../../../components/LineReviewMode/LineReviewMode';
import type { AutoSaveData } from './useAutoSave';
import type { LetterReviewVisit } from './useLetterReviewVisit';

export interface LineReviewRepairIntent {
  token: string;
  pageIndex: number;
  originalFilename?: string;
  repairText?: string;
}

const LINE_REVIEW_REPAIR_QUERY_KEYS = [
  'repairGeometry',
  'repairIntent',
  'repairPageIndex',
  'repairPageFilename',
  'repairText',
] as const;

export function lineReviewRepairIntentFromSearch(
  search: string,
): LineReviewRepairIntent | null {
  const params = new URLSearchParams(search);
  if (params.get('repairGeometry') !== '1') return null;

  const token = params.get('repairIntent')?.trim();
  const pageIndexValue = params.get('repairPageIndex');
  const pageIndex = pageIndexValue === null
    ? Number.NaN
    : Number(pageIndexValue);
  if (!token || !Number.isInteger(pageIndex) || pageIndex < 0) return null;

  const originalFilename = params.get('repairPageFilename')?.trim();
  const repairText = params.get('repairText')?.trim();
  return {
    token,
    pageIndex,
    ...(originalFilename ? { originalFilename } : {}),
    ...(repairText ? { repairText } : {}),
  };
}

export function searchAfterLineReviewRepairConsumption(
  search: string,
  token: string,
): string | null {
  const params = new URLSearchParams(search);
  if (params.get('repairIntent') !== token) return null;
  LINE_REVIEW_REPAIR_QUERY_KEYS.forEach((key) => params.delete(key));
  return params.toString();
}

interface UseLineReviewWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  editorRef: RefObject<HTMLDivElement | null>;
  isTranscriptEditing: boolean;
  lineReviewBlocked: boolean;
  repairIntent?: LineReviewRepairIntent | null;
  onRepairIntentConsumed?: (token: string) => void;
  onTranscriptChange: (text: string) => void;
  onAutoSave: (data: AutoSaveData) => void;
}

type LineReviewEntry =
  | {
      kind: 'closed';
      previousOwner?: LineReviewEntryOwner;
    }
  | {
      kind: 'standard';
      owner: LineReviewEntryOwner;
    }
  | {
      kind: 'segment-first';
      owner: LineReviewEntryOwner;
      repairText: string | undefined;
    };

interface LineReviewEntryOwner {
  isActive: () => boolean;
  deactivate: () => void;
  supersede: () => void;
  canRefresh: () => boolean;
  beginRefresh: () => object;
  isCurrentRefresh: (refresh: object) => boolean;
}

interface LineReviewSession {
  owner: LetterReviewVisit;
  entry: LineReviewEntry;
  viewerPageIndex: number;
  debugMode: boolean;
  selectedText: string;
}

interface OwnedModeHandle {
  owner: LineReviewEntryOwner;
  handle: LineReviewModeHandle | null;
}

const entryOwnerFrom = (
  visit: LetterReviewVisit,
): LineReviewEntryOwner => {
  let active = true;
  let superseded = false;
  let currentRefresh: object | null = null;

  return {
    isActive: () => active && !superseded && visit.isActive(),
    deactivate: () => {
      active = false;
    },
    supersede: () => {
      active = false;
      superseded = true;
      currentRefresh = null;
    },
    canRefresh: () => !superseded && visit.isActive(),
    beginRefresh: () => {
      const refresh = {};
      currentRefresh = refresh;
      return refresh;
    },
    isCurrentRefresh: (refresh) => (
      !superseded
      && visit.isActive()
      && currentRefresh === refresh
    ),
  };
};

const sessionFrom = (owner: LetterReviewVisit): LineReviewSession => ({
  owner,
  entry: { kind: 'closed' },
  viewerPageIndex: 0,
  debugMode: false,
  selectedText: '',
});

const validPageIndex = (
  letter: Letter | null,
  candidate: number,
): number => (
  letter
  && Number.isInteger(candidate)
  && candidate >= 0
  && candidate < letter.images.length
    ? candidate
    : 0
);

const repairPageIndex = (
  letter: Letter,
  intent: LineReviewRepairIntent,
): number | null => {
  const exactFilename = intent.originalFilename?.trim();
  if (exactFilename) {
    const matches = letter.images
      .map((image, index) => ({ image, index }))
      .filter(({ image }) => image.originalFilename === exactFilename);
    return matches.length === 1 ? matches[0].index : null;
  }

  return Number.isInteger(intent.pageIndex)
    && intent.pageIndex >= 0
    && intent.pageIndex < letter.images.length
    ? intent.pageIndex
    : null;
};

/**
 * Owns the complete Line Review session for one Letter Review visit.
 *
 * Session state is tagged with the opaque visit rather than a letter ID.
 * Each mounted review entry has a narrower owner token so controls and async
 * completions also fail closed after exit and reopen within the same visit.
 */
export function useLineReviewWorkspace({
  visit,
  letter,
  editorRef,
  isTranscriptEditing,
  lineReviewBlocked,
  repairIntent,
  onRepairIntentConsumed,
  onTranscriptChange,
  onAutoSave,
}: UseLineReviewWorkspaceOptions) {
  const repairConsumptionRef = useRef(
    new WeakMap<LetterReviewVisit, Set<string>>(),
  );
  const [storedModeHandle, setStoredModeHandle] =
    useState<OwnedModeHandle | null>(null);
  const [storedSession, setStoredSession] = useState(
    () => sessionFrom(visit),
  );
  const session = storedSession.owner === visit
    ? storedSession
    : sessionFrom(visit);
  const entryOwner = session.entry.kind === 'closed'
    ? null
    : session.entry.owner;
  const previousEntryOwner = session.entry.kind === 'closed'
    ? session.entry.previousOwner
    : undefined;
  const modeHandle = entryOwner
    && storedModeHandle?.owner === entryOwner
    ? storedModeHandle.handle
    : null;
  const transcriptSelectionEnabled = (
    (
      letter?.transcriptStatus !== undefined
      && letter.transcriptStatus !== 'VERIFIED'
    )
    || isTranscriptEditing
  );
  const selectedText = transcriptSelectionEnabled
    ? session.selectedText
    : '';
  const active = session.entry.kind !== 'closed';
  const viewerPageIndex = validPageIndex(
    letter,
    session.viewerPageIndex,
  );
  const currentFilename =
    letter?.images[viewerPageIndex]?.originalFilename
    ?? letter?.images[0]?.originalFilename;

  const updateSession = useCallback((
    update: (current: LineReviewSession) => LineReviewSession,
  ) => {
    if (!visit.isActive()) return;

    setStoredSession((current) => update(
      current.owner === visit ? current : sessionFrom(visit),
    ));
  }, [visit]);

  const consumeRepairIntent = useCallback((
    intent: LineReviewRepairIntent,
  ) => {
    let consumedTokens = repairConsumptionRef.current.get(visit);
    if (!consumedTokens) {
      consumedTokens = new Set();
      repairConsumptionRef.current.set(visit, consumedTokens);
    }
    if (
      !visit.isActive()
      || !letter
      || !hasPrimaryTranscriptContent(letter)
      || isTranscriptEditing
      || lineReviewBlocked
      || session.entry.kind !== 'closed'
      || consumedTokens.has(intent.token)
    ) {
      return;
    }

    const targetPageIndex = repairPageIndex(letter, intent);
    consumedTokens.add(intent.token);
    onRepairIntentConsumed?.(intent.token);
    if (targetPageIndex === null) return;

    previousEntryOwner?.supersede();
    const repairText = intent.repairText?.trim() || undefined;
    updateSession((current) => (
      current.entry.kind === 'closed'
        ? {
            ...current,
            entry: {
              kind: 'segment-first',
              owner: entryOwnerFrom(visit),
              repairText,
            },
            viewerPageIndex: targetPageIndex,
          }
        : current
    ));
  }, [
    isTranscriptEditing,
    letter,
    lineReviewBlocked,
    onRepairIntentConsumed,
    previousEntryOwner,
    session.entry.kind,
    updateSession,
    visit,
  ]);

  useEffect(() => {
    if (!repairIntent) return;
    queueMicrotask(() => consumeRepairIntent(repairIntent));
  }, [
    consumeRepairIntent,
    repairIntent,
  ]);

  useEffect(() => {
    const clearSelection = () => {
      updateSession((current) => (
        current.selectedText.length === 0
          ? current
          : { ...current, selectedText: '' }
      ));
    };
    const handleSelectionChange = () => {
      const editor = editorRef.current;
      const selection = window.getSelection();

      if (
        !editor
        || !transcriptSelectionEnabled
        || !selection
        || selection.rangeCount === 0
      ) {
        clearSelection();
        return;
      }

      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) {
        clearSelection();
        return;
      }

      const nextSelectedText = selection.toString().trim();
      updateSession((current) => (
        current.selectedText === nextSelectedText
          ? current
          : { ...current, selectedText: nextSelectedText }
      ));
    };

    if (!transcriptSelectionEnabled) {
      clearSelection();
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener(
        "selectionchange",
        handleSelectionChange,
      );
    };
  }, [
    editorRef,
    transcriptSelectionEnabled,
    updateSession,
  ]);

  const onPageChange = useCallback((pageIndex: number) => {
    updateSession((current) => ({
      ...current,
      viewerPageIndex: validPageIndex(letter, pageIndex),
    }));
  }, [letter, updateSession]);

  const onImageClick = useCallback((pageIndex: number) => {
    if (
      !letter
      || !hasPrimaryTranscriptContent(letter)
      || isTranscriptEditing
      || lineReviewBlocked
      || session.entry.kind !== 'closed'
    ) {
      return;
    }
    previousEntryOwner?.supersede();

    updateSession((current) => (
      current.entry.kind === 'closed'
        ? {
            ...current,
            entry: {
              kind: 'standard',
              owner: entryOwnerFrom(visit),
            },
            viewerPageIndex: validPageIndex(letter, pageIndex),
          }
        : current
    ));
  }, [
    isTranscriptEditing,
    letter,
    lineReviewBlocked,
    previousEntryOwner,
    session.entry.kind,
    updateSession,
    visit,
  ]);

  const onExit = useCallback(() => {
    if (!entryOwner?.isActive()) return;
    entryOwner.deactivate();

    updateSession((current) => (
      current.entry.kind !== 'closed'
      && current.entry.owner === entryOwner
        ? {
            ...current,
            entry: {
              kind: 'closed',
              previousOwner: entryOwner,
            },
          }
        : current
    ));
  }, [entryOwner, updateSession]);

  const setModeDebugMode = useCallback((debugMode: boolean) => {
    if (!entryOwner?.isActive()) return;

    updateSession((current) => (
      current.entry.kind !== 'closed'
      && current.entry.owner === entryOwner
        ? { ...current, debugMode }
        : current
    ));
  }, [entryOwner, updateSession]);

  const toggleDebugMode = useCallback(() => {
    if (!entryOwner?.isActive()) return;

    updateSession((current) => (
      current.entry.kind !== 'closed'
      && current.entry.owner === entryOwner
        ? {
            ...current,
            debugMode: !current.debugMode,
          }
        : current
    ));
  }, [entryOwner, updateSession]);

  const modeRef = useCallback((nextHandle: LineReviewModeHandle | null) => {
    if (!entryOwner) return;
    if (nextHandle === null) {
      setStoredModeHandle((current) => (
        current?.owner === entryOwner ? null : current
      ));
      return;
    }
    if (!entryOwner.isActive()) return;
    setStoredModeHandle({
      owner: entryOwner,
      handle: nextHandle,
    });
  }, [entryOwner]);

  const reloadSegments = useCallback(() => {
    if (!entryOwner?.isActive()) return;
    modeHandle?.reloadSegments();
  }, [entryOwner, modeHandle]);

  const hasPendingChanges = useCallback(() => (
    !!entryOwner?.isActive()
    && (
      modeHandle === null
      || modeHandle.hasPendingChanges()
    )
  ), [entryOwner, modeHandle]);

  const flushPendingChanges = useCallback(async () => {
    if (!entryOwner?.isActive()) return false;
    return modeHandle?.flushPendingChanges() ?? false;
  }, [entryOwner, modeHandle]);

  const reviewSegments = useCallback(() => {
    if (session.entry.kind !== 'closed') return;
    previousEntryOwner?.supersede();

    updateSession((current) => (
      current.entry.kind === 'closed'
        ? {
            ...current,
            entry: {
              kind: 'segment-first',
              owner: entryOwnerFrom(visit),
              repairText: undefined,
            },
          }
        : current
    ));
  }, [
    previousEntryOwner,
    session.entry.kind,
    updateSession,
    visit,
  ]);

  const repairSelectedText = useCallback(() => {
    if (
      !transcriptSelectionEnabled
      || session.entry.kind !== 'closed'
      || session.selectedText.trim().length === 0
    ) {
      return;
    }
    previousEntryOwner?.supersede();

    updateSession((current) => {
      if (current.entry.kind !== 'closed') return current;

      const repairText = current.selectedText.trim();
      if (repairText.length === 0) return current;

      return {
        ...current,
        entry: {
          kind: 'segment-first',
          owner: entryOwnerFrom(visit),
          repairText,
        },
      };
    });
  }, [
    previousEntryOwner,
    session.entry.kind,
    session.selectedText,
    transcriptSelectionEnabled,
    updateSession,
    visit,
  ]);

  const guardedTranscriptChange = useCallback((text: string) => {
    if (!entryOwner?.isActive()) return;
    startTransition(() => {
      onTranscriptChange(text);
    });
  }, [entryOwner, onTranscriptChange]);

  const guardedAutoSave = useCallback((data: AutoSaveData) => {
    if (!entryOwner?.isActive()) return;
    void onAutoSave(data);
  }, [entryOwner, onAutoSave]);

  const repairText = session.entry.kind === 'segment-first'
    ? session.entry.repairText
    : undefined;

  return {
    active,
    currentFilename,
    selectedText,
    modeRef,
    viewerProps: {
      onPageChange,
      onImageClick,
    },
    headerControls: {
      debugMode: session.debugMode,
      toggleDebugMode,
      reloadSegments,
      reloadDisabled: modeHandle?.isLoading ?? false,
    },
    navigationControls: {
      flushPendingChanges,
      hasPendingChanges,
    },
    repairControls: {
      reviewSegments,
      repairSelectedText,
    },
    modeProps: {
      onTranscriptChange: guardedTranscriptChange,
      onExit,
      onAutoSave: guardedAutoSave,
      debugMode: session.debugMode,
      onDebugModeChange: setModeDebugMode,
      initialPageIndex: viewerPageIndex,
      fullViewport: session.entry.kind === 'segment-first',
      repairText,
    },
  } as const;
}
