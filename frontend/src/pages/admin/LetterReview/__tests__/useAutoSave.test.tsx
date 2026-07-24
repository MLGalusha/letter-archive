import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Letter } from '../../../../types/Letter';
import { useAutoSave } from '../useAutoSave';

const {
  createVersionMock,
  updateLetterMock,
  updateIdentityMock,
  retagMetadataMock,
  trackEditMock,
} = vi.hoisted(() => ({
  createVersionMock: vi.fn(),
  updateLetterMock: vi.fn(),
  updateIdentityMock: vi.fn(),
  retagMetadataMock: vi.fn(),
  trackEditMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  createVersion: createVersionMock,
  updateLetter: updateLetterMock,
}));

vi.mock('../../../../api/admin/letters', () => ({
  updateIdentity: updateIdentityMock,
  retagMetadata: retagMetadataMock,
}));

vi.mock('../../../../api/client', () => ({
  getErrorMessage: vi.fn((_error: unknown, fallback: string) => fallback),
}));

vi.mock('../../../../utils/recentEdits', () => ({
  trackEdit: trackEditMock,
}));

function makeLetter(primarySourceRevision: number): Letter {
  return {
    id: 'letter-1',
    title: 'Letter',
    collectionCode: '001',
    primarySourceRevision,
    images: [],
    transcript: { pages: [], fullText: '', verified: false },
    metadata: {
      sender: 'Old Sender',
      recipient: 'Recipient',
      location: 'Old Location',
      hook: 'Old Hook',
      description: 'Old Summary',
      verified: false,
    },
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

describe('useAutoSave page-source ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    createVersionMock.mockResolvedValue({
      versionNumber: 1,
      createdAt: '2026-07-24T12:00:00.000Z',
    });
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it('keeps the source revision from the first delayed identity edit through re-tagging', async () => {
    const sourceSeven = makeLetter(7);
    const setLetter = vi.fn();
    const syncIdentityMetadata = vi.fn();
    updateIdentityMock.mockResolvedValue({
      ...makeLetter(9),
      metadata: { ...sourceSeven.metadata, sender: 'New Sender' },
    });
    retagMetadataMock.mockResolvedValue({
      ...sourceSeven,
      metadata: { ...sourceSeven.metadata, sender: 'New Sender' },
    });

    const { result, rerender } = renderHook(
      ({ letter }: { letter: Letter }) => useAutoSave({
        letterId: letter.id,
        letter,
        setLetter,
        handleMutationError: vi.fn(() => false),
        isMutationBlocked: vi.fn(() => false),
        mutationsBlocked: false,
        syncIdentityMetadata,
      }),
      { initialProps: { letter: sourceSeven } },
    );

    act(() => {
      void result.current.triggerAutoSave({ sender: 'New Sender' });
    });
    act(() => {
      rerender({ letter: makeLetter(8) });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(updateIdentityMock).toHaveBeenCalledWith('letter-1', {
      primarySourceRevision: 7,
      expectedSender: 'Old Sender',
      sender: 'New Sender',
    });
    expect(retagMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({
        primarySourceRevision: 7,
        field: 'sender',
        oldSender: 'Old Sender',
        newSender: 'New Sender',
      }),
      expect.any(AbortSignal),
    );
  });

  it('keeps an automatic version on the source revision that accepted the save', async () => {
    const original = makeLetter(7);
    const saved = {
      ...original,
      primarySourceRevision: 9,
      transcript: {
        ...original.transcript,
        fullText: 'Edited transcript',
      },
    };
    updateLetterMock.mockResolvedValue(saved);

    const { result } = renderHook(() => useAutoSave({
      letterId: original.id,
      letter: original,
      setLetter: vi.fn(),
      handleMutationError: vi.fn(() => false),
      isMutationBlocked: vi.fn(() => false),
      mutationsBlocked: false,
      syncIdentityMetadata: vi.fn(),
    }));

    act(() => {
      void result.current.triggerAutoSave({
        transcriptionText: 'Edited transcript',
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(createVersionMock).toHaveBeenCalledWith(
      'letter-1',
      7,
      'transcript',
      'Edited transcript',
      'human',
    );
  });

  it('preserves an explicit null in the metadata version snapshot', async () => {
    const original = makeLetter(7);
    updateLetterMock.mockResolvedValue({
      ...original,
      metadata: {
        ...original.metadata,
        recipient: 'Authoritative Recipient',
        location: undefined,
      },
    });

    const { result } = renderHook(() => useAutoSave({
      letterId: original.id,
      letter: original,
      setLetter: vi.fn(),
      handleMutationError: vi.fn(() => false),
      isMutationBlocked: vi.fn(() => false),
      mutationsBlocked: false,
      syncIdentityMetadata: vi.fn(),
    }));

    act(() => {
      void result.current.triggerAutoSave({ locationWritten: null });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(createVersionMock).toHaveBeenCalledWith(
      'letter-1',
      7,
      'metadata',
      {
        sender: 'Old Sender',
        recipient: 'Authoritative Recipient',
        locationWritten: null,
        hook: 'Old Hook',
        summary: 'Old Summary',
      },
      'human',
    );
  });

  it('reports a history-only failure without misreporting the committed content save', async () => {
    const original = makeLetter(7);
    const saved = {
      ...original,
      transcript: {
        ...original.transcript,
        fullText: 'Saved transcript',
      },
    };
    const setLetter = vi.fn();
    const handleMutationError = vi.fn(() => false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateLetterMock.mockResolvedValue(saved);
    createVersionMock.mockRejectedValue(Object.assign(
      new Error('version history changed'),
      { status: 409 },
    ));

    const { result } = renderHook(() => useAutoSave({
      letterId: original.id,
      letter: original,
      setLetter,
      handleMutationError,
      isMutationBlocked: vi.fn(() => false),
      mutationsBlocked: false,
      syncIdentityMetadata: vi.fn(),
    }));

    act(() => {
      void result.current.triggerAutoSave({ transcriptionText: 'Saved transcript' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(setLetter).toHaveBeenCalledWith(saved);
    expect(result.current.autoSaveStatus).toBe('saved');
    expect(handleMutationError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'version history changed',
        status: 409,
      }),
      'Changes saved, but version history could not be recorded',
    );
    consoleError.mockRestore();
  });

  it('cancels a queued save when the source owner becomes terminal', async () => {
    const original = makeLetter(7);
    const { result, rerender } = renderHook(
      ({ mutationsBlocked }) => useAutoSave({
        letterId: original.id,
        letter: original,
        setLetter: vi.fn(),
        handleMutationError: vi.fn(() => mutationsBlocked),
        isMutationBlocked: () => mutationsBlocked,
        mutationsBlocked,
        syncIdentityMetadata: vi.fn(),
      }),
      { initialProps: { mutationsBlocked: false } },
    );

    act(() => {
      void result.current.triggerAutoSave({
        transcriptionText: 'Stale pending edit',
      });
    });
    act(() => {
      rerender({ mutationsBlocked: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(updateLetterMock).not.toHaveBeenCalled();
    expect(createVersionMock).not.toHaveBeenCalled();
  });
});
