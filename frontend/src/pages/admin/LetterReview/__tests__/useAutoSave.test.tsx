import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Letter } from '../../../../types/Letter';
import { useAutoSave } from '../useAutoSave';
import { useGuardedLetterState } from '../useGuardedLetterState';
import { useLetterReviewVisit } from '../useLetterReviewVisit';
import { useLetterSourceConflict } from '../useLetterSourceConflict';

const {
  createVersionMock,
  retryPendingIdentityWorkMock,
  scheduleIdentityUpdateMock,
  trackEditMock,
  useIdentityAutoSaveMock,
  updateLetterMock,
} = vi.hoisted(() => ({
  createVersionMock: vi.fn(),
  retryPendingIdentityWorkMock: vi.fn(),
  scheduleIdentityUpdateMock: vi.fn(),
  trackEditMock: vi.fn(),
  useIdentityAutoSaveMock: vi.fn(),
  updateLetterMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  createVersion: createVersionMock,
  updateLetter: updateLetterMock,
}));

vi.mock('../../../../utils/recentEdits', () => ({
  trackEdit: trackEditMock,
}));

vi.mock('../useIdentityAutoSave', () => ({
  useIdentityAutoSave: useIdentityAutoSaveMock,
}));

interface HarnessDependencies {
  tryAdoptLetter: (letter: Letter) => boolean;
  handleMutationError: (error: unknown, fallback: string) => boolean;
  syncIdentityMetadata: (letter: Letter) => void;
}

function useSimpleAutoSave(
  letter: Letter,
  mutationsBlocked: boolean,
  dependencies: HarnessDependencies,
) {
  const visit = useLetterReviewVisit(letter.id);
  return useAutoSave({
    visit,
    letter,
    tryAdoptLetter: dependencies.tryAdoptLetter,
    handleMutationError: dependencies.handleMutationError,
    isMutationBlocked: () => mutationsBlocked,
    mutationsBlocked,
    syncIdentityMetadata: dependencies.syncIdentityMetadata,
  });
}

function makeLetter(
  id = 'letter-1',
  primarySourceRevision = 7,
  overrides: Partial<Letter> = {},
): Letter {
  return {
    id,
    title: `Letter ${id}`,
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
    ...overrides,
  };
}

function withMetadata(
  letter: Letter,
  metadata: Partial<Letter['metadata']>,
): Letter {
  return {
    ...letter,
    metadata: {
      ...letter.metadata,
      ...metadata,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    createVersionMock.mockResolvedValue({
      versionNumber: 1,
      createdAt: '2026-07-24T12:00:00.000Z',
    });
    useIdentityAutoSaveMock.mockReturnValue({
      identityUpdateState: 'idle',
      identityUpdateSecondsRemaining: 0,
      retryPendingIdentityWork: retryPendingIdentityWorkMock,
      retagState: 'idle',
      scheduleIdentityUpdate: scheduleIdentityUpdateMock,
    });
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it('merges partial letter fields while keeping the latest same-field value', async () => {
    const original = makeLetter();
    const saved = withMetadata(original, {
      hook: 'Merged hook',
      location: 'London',
    });
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    updateLetterMock.mockResolvedValue(saved);
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({ locationWritten: 'Paris' });
      void result.current.triggerAutoSave({ hook: 'Merged hook' });
      void result.current.triggerAutoSave({ locationWritten: 'London' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(updateLetterMock).toHaveBeenCalledTimes(1);
    expect(updateLetterMock).toHaveBeenCalledWith('letter-1', {
      hook: 'Merged hook',
      locationWritten: 'London',
      primarySourceRevision: 7,
    });
    expect(dependencies.tryAdoptLetter).toHaveBeenCalledWith(saved);
    expect(trackEditMock).toHaveBeenCalledWith({
      id: saved.id,
      metadata: saved.metadata,
      collectionCode: saved.collectionCode,
    });
  });

  it('persists every editable structured metadata field in one patch', async () => {
    const original = makeLetter();
    const saved = withMetadata(original, {
      extractedDate: '1920-03-15',
      emotionalTone: 'matter-of-fact',
      senderRecipientRelationship: 'parent-child',
      primaryTopics: ['family/marriage'],
    });
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    updateLetterMock.mockResolvedValue(saved);
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({
        extractedDate: '1920-03-15',
        emotionalTone: 'matter-of-fact',
        senderRecipientRelationship: 'parent-child',
        primaryTopics: ['family/marriage'],
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(updateLetterMock).toHaveBeenCalledWith('letter-1', {
      primarySourceRevision: 7,
      extractedDate: '1920-03-15',
      emotionalTone: 'matter-of-fact',
      senderRecipientRelationship: 'parent-child',
      primaryTopics: ['family/marriage'],
    });
    expect(createVersionMock).toHaveBeenCalledWith(
      'letter-1',
      7,
      'metadata',
      expect.objectContaining({
        extractedDate: '1920-03-15',
        emotionalTone: 'matter-of-fact',
        senderRecipientRelationship: 'parent-child',
        primaryTopics: ['family/marriage'],
      }),
      'human',
    );
  });

  it('keeps a failed patch in the next same-lane save', async () => {
    const original = makeLetter();
    const saved = withMetadata(original, {
      hook: 'Recovered hook',
      location: 'Philadelphia',
    });
    const failure = new Error('first patch failed');
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    updateLetterMock
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(saved);
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({
        hook: 'Recovered hook',
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(updateLetterMock).toHaveBeenCalledTimes(1);

    act(() => {
      void result.current.triggerAutoSave({
        locationWritten: 'Philadelphia',
      });
    });
    let flushed = false;
    await act(async () => {
      flushed = await result.current.flushPendingSaves();
    });

    expect(flushed).toBe(true);
    expect(updateLetterMock).toHaveBeenNthCalledWith(2, 'letter-1', {
      hook: 'Recovered hook',
      locationWritten: 'Philadelphia',
      primarySourceRevision: 7,
    });
  });

  it('isolates queued writes by source target across A -> B navigation', async () => {
    const letterA = makeLetter('letter-a', 3);
    const letterB = makeLetter('letter-b', 8);
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    updateLetterMock.mockImplementation(async (id: string) => (
      id === letterA.id ? letterA : letterB
    ));
    const { result, rerender } = renderHook(
      ({ letter }) => useSimpleAutoSave(letter, false, dependencies),
      { initialProps: { letter: letterA } },
    );

    act(() => {
      void result.current.triggerAutoSave({ hook: 'Queued for A' });
    });
    rerender({ letter: letterB });
    act(() => {
      void result.current.triggerAutoSave({ notes: 'Queued for B' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(updateLetterMock).toHaveBeenCalledTimes(2);
    expect(updateLetterMock).toHaveBeenCalledWith('letter-a', {
      hook: 'Queued for A',
      primarySourceRevision: 3,
    });
    expect(updateLetterMock).toHaveBeenCalledWith('letter-b', {
      notes: 'Queued for B',
      primarySourceRevision: 8,
    });
  });

  it('does not merge a queued first-A patch into a fresh A visit', async () => {
    const firstA = makeLetter('letter-a', 4);
    const letterB = makeLetter('letter-b', 2);
    const freshA = withMetadata(makeLetter('letter-a', 4), {
      hook: 'Fresh authoritative A',
    });
    const savedA = withMetadata(freshA, {
      location: 'Fresh visit location',
    });
    updateLetterMock.mockResolvedValue(savedA);
    const { result, rerender } = renderHook(
      ({ routeLetter }) => {
        const visit = useLetterReviewVisit(routeLetter.id);
        const conflict = useLetterSourceConflict(vi.fn(), visit);
        const guarded = useGuardedLetterState(
          conflict.markSourceConflict,
          visit,
        );
        const autosave = useAutoSave({
          visit,
          letter: guarded.letter,
          tryAdoptLetter: guarded.tryAdoptLetter,
          handleMutationError: conflict.handleMutationError,
          isMutationBlocked: conflict.isMutationBlocked,
          mutationsBlocked: conflict.mutationsBlocked,
          syncIdentityMetadata: vi.fn(),
        });
        return { ...guarded, ...autosave };
      },
      { initialProps: { routeLetter: firstA } },
    );

    act(() => {
      result.current.setAuthoritativeLetter(firstA);
    });
    act(() => {
      void result.current.triggerAutoSave({ hook: 'Queued first-A hook' });
    });

    rerender({ routeLetter: letterB });
    act(() => {
      result.current.setAuthoritativeLetter(letterB);
    });
    rerender({ routeLetter: freshA });
    act(() => {
      result.current.setAuthoritativeLetter(freshA);
    });
    act(() => {
      void result.current.triggerAutoSave({
        locationWritten: 'Fresh visit location',
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(updateLetterMock).toHaveBeenCalledTimes(1);
    expect(updateLetterMock).toHaveBeenCalledWith('letter-a', {
      locationWritten: 'Fresh visit location',
      primarySourceRevision: 4,
    });
  });

  it('takes a patch snapshot before awaiting and serializes the next edit', async () => {
    const original = makeLetter();
    const firstRequest = deferred<Letter>();
    const firstSaved = withMetadata(original, { hook: 'First' });
    const secondSaved = withMetadata(original, { hook: 'Second' });
    updateLetterMock
      .mockReturnValueOnce(firstRequest.promise)
      .mockResolvedValueOnce(secondSaved);
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({ hook: 'First' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(updateLetterMock).toHaveBeenCalledTimes(1);

    act(() => {
      void result.current.triggerAutoSave({ hook: 'Second' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(updateLetterMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRequest.resolve(firstSaved);
      await firstRequest.promise;
    });

    expect(updateLetterMock).toHaveBeenCalledTimes(2);
    expect(updateLetterMock).toHaveBeenNthCalledWith(1, 'letter-1', {
      hook: 'First',
      primarySourceRevision: 7,
    });
    expect(updateLetterMock).toHaveBeenNthCalledWith(2, 'letter-1', {
      hook: 'Second',
      primarySourceRevision: 7,
    });
  });

  it('rejects an old A DTO after A -> B -> A while preserving its backend write', async () => {
    const firstA = makeLetter('letter-a', 4);
    const letterB = makeLetter('letter-b', 2);
    const freshA = withMetadata(makeLetter('letter-a', 4), {
      hook: 'Fresh A',
    });
    const oldSavedA = withMetadata(firstA, { hook: 'Old A response' });
    const oldRequest = deferred<Letter>();
    const showToast = vi.fn();
    const syncIdentityMetadata = vi.fn();
    updateLetterMock.mockReturnValueOnce(oldRequest.promise);
    const { result, rerender } = renderHook(
      ({ routeLetter }) => {
        const visit = useLetterReviewVisit(routeLetter.id);
        const conflict = useLetterSourceConflict(showToast, visit);
        const guarded = useGuardedLetterState(
          conflict.markSourceConflict,
          visit,
        );
        const autosave = useAutoSave({
          visit,
          letter: guarded.letter,
          tryAdoptLetter: guarded.tryAdoptLetter,
          handleMutationError: conflict.handleMutationError,
          isMutationBlocked: conflict.isMutationBlocked,
          mutationsBlocked: conflict.mutationsBlocked,
          syncIdentityMetadata,
        });
        return { ...guarded, ...autosave };
      },
      { initialProps: { routeLetter: firstA } },
    );

    act(() => {
      result.current.setAuthoritativeLetter(firstA);
    });
    const triggerOldA = result.current.triggerAutoSave;
    act(() => {
      void triggerOldA({ hook: 'Old A response' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(updateLetterMock).toHaveBeenCalledTimes(1);

    rerender({ routeLetter: letterB });
    act(() => {
      result.current.setAuthoritativeLetter(letterB);
    });
    rerender({ routeLetter: freshA });
    act(() => {
      result.current.setAuthoritativeLetter(freshA);
    });

    await act(async () => {
      oldRequest.resolve(oldSavedA);
      await oldRequest.promise;
    });

    expect(updateLetterMock).toHaveBeenCalledWith('letter-a', {
      hook: 'Old A response',
      primarySourceRevision: 4,
    });
    expect(result.current.letter).toBe(freshA);
    expect(result.current.letter?.metadata.hook).toBe('Fresh A');
    expect(result.current.autoSaveStatus).toBe('idle');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('records transcript history against the source that accepted the save', async () => {
    const original = makeLetter('letter-1', 7);
    const saved = {
      ...original,
      primarySourceRevision: 9,
      transcript: {
        ...original.transcript,
        fullText: 'Edited transcript',
      },
    };
    updateLetterMock.mockResolvedValue(saved);
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

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
    const original = makeLetter();
    const saved = withMetadata(original, {
      recipient: 'Authoritative Recipient',
      location: undefined,
    });
    updateLetterMock.mockResolvedValue(saved);
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

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

  it('reports a history-only failure without misreporting the committed save', async () => {
    const original = makeLetter();
    const saved = {
      ...original,
      transcript: {
        ...original.transcript,
        fullText: 'Saved transcript',
      },
    };
    const handleMutationError = vi.fn(() => false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateLetterMock.mockResolvedValue(saved);
    createVersionMock.mockRejectedValue(Object.assign(
      new Error('version history changed'),
      { status: 409 },
    ));
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError,
      syncIdentityMetadata: vi.fn(),
    };
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({
        transcriptionText: 'Saved transcript',
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(dependencies.tryAdoptLetter).toHaveBeenCalledWith(saved);
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

  it('cancels and forgets the active target patch after a terminal conflict', async () => {
    const original = makeLetter();
    const saved = { ...original, notes: 'Fresh note' };
    updateLetterMock.mockResolvedValue(saved);
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ mutationsBlocked }) =>
        useSimpleAutoSave(original, mutationsBlocked, dependencies),
      { initialProps: { mutationsBlocked: false } },
    );

    act(() => {
      void result.current.triggerAutoSave({ hook: 'Canceled hook' });
    });
    rerender({ mutationsBlocked: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(updateLetterMock).not.toHaveBeenCalled();

    rerender({ mutationsBlocked: false });
    act(() => {
      void result.current.triggerAutoSave({ notes: 'Fresh note' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(updateLetterMock).toHaveBeenCalledWith('letter-1', {
      notes: 'Fresh note',
      primarySourceRevision: 7,
    });
  });

  it('delegates identity fields while saving remaining fields generically', async () => {
    const original = makeLetter();
    const saved = withMetadata(original, { hook: 'Updated hook' });
    updateLetterMock.mockResolvedValue(saved);
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({
        sender: 'Ada',
        hook: 'Updated hook',
      });
    });
    expect(scheduleIdentityUpdateMock).toHaveBeenCalledWith({ sender: 'Ada' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(updateLetterMock).toHaveBeenCalledWith('letter-1', {
      hook: 'Updated hook',
      primarySourceRevision: 7,
    });
  });

  it('keeps queued hook and summary drafts over an older identity DTO', () => {
    const original = makeLetter();
    updateLetterMock.mockResolvedValue(original);
    const syncIdentityMetadata = vi.fn();
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata,
    };
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({
        hook: 'Queued hook draft',
        summary: 'Queued summary draft',
      });
    });
    const identityOptions = useIdentityAutoSaveMock.mock.calls.at(-1)?.[0] as {
      syncIdentityMetadata: (letter: Letter) => void;
    };
    const olderIdentityDto = withMetadata(original, {
      hook: 'Retagged older hook',
      taggedHook: 'Retagged older hook',
      description: 'Retagged older summary',
      taggedDescription: 'Retagged older summary',
    });

    act(() => {
      identityOptions.syncIdentityMetadata(olderIdentityDto);
    });

    expect(syncIdentityMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          hook: 'Queued hook draft',
          taggedHook: 'Queued hook draft',
          description: 'Queued summary draft',
          taggedDescription: 'Queued summary draft',
        }),
      }),
    );
  });

  it('keeps identity fields in the generic patch when metadata is empty', async () => {
    const original = makeLetter('letter-1', 7, {
      metadataContentStatus: 'EMPTY',
    });
    const saved = withMetadata(original, { sender: 'Ada' });
    updateLetterMock.mockResolvedValue(saved);
    const dependencies: HarnessDependencies = {
      tryAdoptLetter: vi.fn(() => true),
      handleMutationError: vi.fn(() => false),
      syncIdentityMetadata: vi.fn(),
    };
    const { result } = renderHook(() =>
      useSimpleAutoSave(original, false, dependencies),
    );

    act(() => {
      void result.current.triggerAutoSave({ sender: 'Ada' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(scheduleIdentityUpdateMock).not.toHaveBeenCalled();
    expect(updateLetterMock).toHaveBeenCalledWith('letter-1', {
      sender: 'Ada',
      primarySourceRevision: 7,
    });
  });
});
