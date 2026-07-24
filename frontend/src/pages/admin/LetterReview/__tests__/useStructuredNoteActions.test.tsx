import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Letter,
  StructuredNoteDraft,
} from '../../../../types/Letter';
import type { ExecuteLetterReviewMutation } from '../useLetterReviewMutationExecutor';
import { useStructuredNoteActions } from '../useStructuredNoteActions';

const { addNoteMock, updateNoteStatusMock } = vi.hoisted(() => ({
  addNoteMock: vi.fn(),
  updateNoteStatusMock: vi.fn(),
}));

vi.mock('../../../../api/admin/letters', () => ({
  addNote: addNoteMock,
  updateNoteStatus: updateNoteStatusMock,
}));

function makeLetter(): Letter {
  return {
    id: 'letter-a',
    title: 'Letter A',
    primarySourceRevision: 7,
    images: [],
    transcript: { pages: [], fullText: '', verified: false },
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
  };
}

function adoptedExecutor(): ExecuteLetterReviewMutation {
  const execute: ExecuteLetterReviewMutation = async (mutation) => {
    const response = await mutation.request();
    mutation.afterAdopt?.(response);
  };
  return vi.fn(execute);
}

describe('useStructuredNoteActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds a note through the revision-bound request and success completion', async () => {
    const letter = makeLetter();
    const updated = {
      ...letter,
      aiNotes: 'updated',
    };
    addNoteMock.mockResolvedValue(updated);
    const executeLetterMutation = adoptedExecutor();
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useStructuredNoteActions({
        letter,
        executeLetterMutation,
        showToast,
      }),
    );
    const note = {
      content: 'Check the date',
      category: 'date',
      priority: 'high',
    } satisfies StructuredNoteDraft;

    await act(async () => {
      await result.current.handleAddNote(note);
    });

    expect(addNoteMock).toHaveBeenCalledWith(
      'letter-a',
      7,
      note,
    );
    expect(executeLetterMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        failureMessage: 'Failed to add note',
      }),
    );
    expect(showToast).toHaveBeenCalledWith('Note added', 'success');
  });

  it.each([
    ['resolved', 'Note resolved', 'Failed to resolve note'],
    ['dismissed', 'Note dismissed', 'Failed to dismiss note'],
  ] as const)(
    'updates a note to %s through the revision-bound request',
    async (status, successMessage, failureMessage) => {
      const letter = makeLetter();
      updateNoteStatusMock.mockResolvedValue(letter);
      const executeLetterMutation = adoptedExecutor();
      const showToast = vi.fn();
      const { result } = renderHook(() =>
        useStructuredNoteActions({
          letter,
          executeLetterMutation,
          showToast,
        }),
      );

      await act(async () => {
        await result.current.handleNoteStatusChange('note-1', status);
      });

      expect(updateNoteStatusMock).toHaveBeenCalledWith(
        'letter-a',
        7,
        'note-1',
        status,
      );
      expect(executeLetterMutation).toHaveBeenCalledWith(
        expect.objectContaining({ failureMessage }),
      );
      expect(showToast).toHaveBeenCalledWith(
        successMessage,
        'success',
      );
    },
  );

  it('does not construct note work without an authoritative letter', async () => {
    const executeLetterMutation = vi.fn();
    const { result } = renderHook(() =>
      useStructuredNoteActions({
        letter: null,
        executeLetterMutation,
        showToast: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleAddNote({
        content: 'No owner',
        category: 'context',
        priority: 'low',
      });
      await result.current.handleNoteStatusChange(
        'note-1',
        'resolved',
      );
    });

    expect(executeLetterMutation).not.toHaveBeenCalled();
    expect(addNoteMock).not.toHaveBeenCalled();
    expect(updateNoteStatusMock).not.toHaveBeenCalled();
  });

  it('leaves request failure and error reporting with the executor', async () => {
    const letter = makeLetter();
    const execute: ExecuteLetterReviewMutation = async () => {};
    const executeLetterMutation = vi.fn(execute);
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useStructuredNoteActions({
        letter,
        executeLetterMutation,
        showToast,
      }),
    );

    await act(async () => {
      await result.current.handleNoteStatusChange(
        'note-1',
        'resolved',
      );
    });

    expect(executeLetterMutation).toHaveBeenCalledTimes(1);
    expect(updateNoteStatusMock).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
