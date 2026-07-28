import {
  startTransition,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { RefObject } from 'react';
import { getAdminLetterById } from '../../../api/letters';
import type { Letter } from '../../../types/Letter';
import { hasPrimaryTranscriptContent } from '../../../utils/letterContent';
import type {
  LineReviewModeHandle,
} from '../../../components/LineReviewMode/LineReviewMode';
import type { AutoSaveData } from './useAutoSave';
import type { LetterReviewVisit } from './useLetterReviewVisit';

interface UseLineReviewWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  editorRef: RefObject<HTMLDivElement | null>;
  isTranscriptEditing: boolean;
  lineReviewBlocked: boolean;
  tryAdoptLetter: (letter: Letter) => boolean;
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
      mappingText: string | undefined;
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
  tryAdoptLetter,
  onTranscriptChange,
  onAutoSave,
}: UseLineReviewWorkspaceOptions) {
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
  const mappingOwner = session.entry.kind === 'segment-first'
    ? session.entry.owner
    : null;
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
              mappingText: undefined,
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

  const mapSelectedText = useCallback(() => {
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

      const mappingText = current.selectedText.trim();
      if (mappingText.length === 0) return current;

      return {
        ...current,
        entry: {
          kind: 'segment-first',
          owner: entryOwnerFrom(visit),
          mappingText,
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

  const onMappingComplete = useCallback(() => {
    if (!mappingOwner?.canRefresh()) return;
    const refresh = mappingOwner.beginRefresh();

    if (mappingOwner.isActive()) {
      updateSession((current) => (
        current.entry.kind === 'segment-first'
        && current.entry.owner === mappingOwner
          ? {
              ...current,
              entry: {
                ...current.entry,
                mappingText: undefined,
              },
            }
          : current
      ));
    }

    const targetLetterId = letter?.id;
    if (!targetLetterId) return;

    void getAdminLetterById(targetLetterId)
      .then((updatedLetter) => {
        if (!mappingOwner.isCurrentRefresh(refresh)) return;
        tryAdoptLetter(updatedLetter);
      })
      .catch((error: unknown) => {
        if (!mappingOwner.isCurrentRefresh(refresh)) return;
        console.error('Failed to refresh mapped segments:', error);
      });
  }, [
    letter?.id,
    mappingOwner,
    tryAdoptLetter,
    updateSession,
  ]);

  const mappingText = session.entry.kind === 'segment-first'
    ? session.entry.mappingText
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
    mappingControls: {
      reviewSegments,
      mapSelectedText,
    },
    modeProps: {
      onTranscriptChange: guardedTranscriptChange,
      onExit,
      onAutoSave: guardedAutoSave,
      debugMode: session.debugMode,
      onDebugModeChange: setModeDebugMode,
      initialPageIndex: viewerPageIndex,
      fullViewport: session.entry.kind === 'segment-first',
      mappingText,
      onMappingComplete,
    },
  } as const;
}
