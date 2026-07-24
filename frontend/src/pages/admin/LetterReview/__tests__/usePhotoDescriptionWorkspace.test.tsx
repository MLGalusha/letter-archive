import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Letter } from '../../../../types/Letter';
import { usePhotoDescriptionWorkspace } from '../usePhotoDescriptionWorkspace';
import type { LetterReviewVisit } from '../useLetterReviewVisit';

const {
  describePhotoMock,
  updatePhotoDescriptionMock,
  verifyPhotoDescriptionMock,
  unverifyPhotoDescriptionMock,
  showToastMock,
} = vi.hoisted(() => ({
  describePhotoMock: vi.fn(),
  updatePhotoDescriptionMock: vi.fn(),
  verifyPhotoDescriptionMock: vi.fn(),
  unverifyPhotoDescriptionMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  describePhoto: describePhotoMock,
  updatePhotoDescription: updatePhotoDescriptionMock,
  verifyPhotoDescription: verifyPhotoDescriptionMock,
  unverifyPhotoDescription: unverifyPhotoDescriptionMock,
}));

vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-a',
    title: 'Photo',
    primarySourceRevision: 3,
    images: [{ id: 'image-a', type: 'photo', imageUrl: '/photo.jpg' }],
    transcript: { pages: [], fullText: '', verified: false },
    metadata: { verified: false },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EMPTY',
    metadataContentStatus: 'EMPTY',
    extraContentStatus: 'EMPTY',
    photoDescription: 'Original description',
    photoDescriptionStatus: 'AI_DRAFT',
    photoDescriptionContext: 'Original context',
    createdAt: '2026-07-24T12:00:00.000Z',
    flagged: false,
    ...overrides,
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

function activeVisit(letterId = 'letter-a'): LetterReviewVisit {
  return {
    letterId,
    isActive: () => true,
  };
}

const flushPendingSaves = async () => true;

describe('usePhotoDescriptionWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('owns context generation and adopts the accepted draft', async () => {
    const letter = makeLetter();
    const generated = makeLetter({
      photoDescription: 'Generated description',
      photoDescriptionContext: 'New context',
    });
    const tryAdoptLetter = vi.fn(() => true);
    const options = {
      visit: activeVisit(),
      letter,
      saving: false,
      beginSaving: vi.fn(() => vi.fn()),
      tryAdoptLetter,
      scheduleDebouncedSave: vi.fn(),
      flushPendingSaves,
      handleMutationError: vi.fn(() => false),
    };
    describePhotoMock.mockResolvedValue({
      letter: generated,
      describedCount: 1,
      photoDescriptionStatus: 'AI_DRAFT',
    });
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace(options),
    );

    act(() => {
      result.current.sectionProps.onDescribePhoto();
    });
    expect(result.current.dialogProps.view).toMatchObject({
      isOpen: true,
      draftContext: 'Original context',
    });

    act(() => {
      result.current.dialogProps.onContextChange('New context');
    });
    act(() => {
      result.current.dialogProps.onSubmit();
    });

    await waitFor(() => {
      expect(result.current.sectionProps.photoDescription).toBe(
        'Generated description',
      );
    });
    expect(describePhotoMock).toHaveBeenCalledWith('letter-a', 'New context', 3);
    expect(tryAdoptLetter).toHaveBeenCalledWith(generated);
    expect(result.current.dialogProps.view.isOpen).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith(
      'Generated 1 photo description draft(s)',
      'success',
    );
  });

  it('does not publish local success state when guarded adoption rejects it', async () => {
    const letter = makeLetter();
    const generated = makeLetter({
      primarySourceRevision: 4,
      photoDescription: 'Wrong-source description',
    });
    describePhotoMock.mockResolvedValue({
      letter: generated,
      describedCount: 1,
      photoDescriptionStatus: 'AI_DRAFT',
    });
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace({
        visit: activeVisit(),
        letter,
        saving: false,
        beginSaving: vi.fn(() => vi.fn()),
        tryAdoptLetter: vi.fn(() => false),
        scheduleDebouncedSave: vi.fn(),
        flushPendingSaves,
        handleMutationError: vi.fn(() => false),
      }),
    );

    act(() => {
      result.current.sectionProps.onDescribePhoto();
      result.current.dialogProps.onSubmit();
    });

    await waitFor(() => {
      expect(describePhotoMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.sectionProps.photoDescription).toBe(
      'Original description',
    );
    expect(result.current.dialogProps.view.isOpen).toBe(true);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('keeps the context dialog locked while generation is in flight', async () => {
    const pending = deferred<{
      letter: Letter;
      describedCount: number;
      photoDescriptionStatus: 'AI_DRAFT';
    }>();
    describePhotoMock.mockReturnValue(pending.promise);
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace({
        visit: activeVisit(),
        letter: makeLetter(),
        saving: false,
        beginSaving: vi.fn(() => vi.fn()),
        tryAdoptLetter: vi.fn(() => true),
        scheduleDebouncedSave: vi.fn(),
        flushPendingSaves,
        handleMutationError: vi.fn(() => false),
      }),
    );

    act(() => {
      result.current.sectionProps.onDescribePhoto();
      result.current.dialogProps.onSubmit();
    });
    expect(result.current.dialogProps.view).toMatchObject({
      isOpen: true,
      generating: true,
    });

    act(() => {
      result.current.dialogProps.onCancel();
    });
    expect(result.current.dialogProps.view.isOpen).toBe(true);

    await act(async () => {
      pending.resolve({
        letter: makeLetter({ photoDescription: 'Generated description' }),
        describedCount: 1,
        photoDescriptionStatus: 'AI_DRAFT',
      });
      await pending.promise;
    });
    expect(result.current.dialogProps.view).toMatchObject({
      isOpen: false,
      generating: false,
    });
  });

  it('ignores a late generation response after A to B navigation', async () => {
    const pending = deferred<{
      letter: Letter;
      describedCount: number;
      photoDescriptionStatus: 'AI_DRAFT';
    }>();
    describePhotoMock.mockReturnValue(pending.promise);
    const tryAdoptLetter = vi.fn(() => true);
    const shared = {
      visit: activeVisit(),
      saving: false,
      beginSaving: vi.fn(() => vi.fn()),
      tryAdoptLetter,
      scheduleDebouncedSave: vi.fn(),
      flushPendingSaves,
      handleMutationError: vi.fn(() => false),
    };
    const { result, rerender } = renderHook(
      ({ letter }) => usePhotoDescriptionWorkspace({ ...shared, letter }),
      { initialProps: { letter: makeLetter() } },
    );

    act(() => {
      result.current.sectionProps.onDescribePhoto();
      result.current.dialogProps.onSubmit();
    });
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        photoDescription: 'Letter B description',
        photoDescriptionContext: 'Letter B context',
      }),
    });

    await act(async () => {
      pending.resolve({
        letter: makeLetter({ photoDescription: 'Late A description' }),
        describedCount: 1,
        photoDescriptionStatus: 'AI_DRAFT',
      });
      await pending.promise;
    });

    expect(result.current.sectionProps.photoDescription).toBe(
      'Letter B description',
    );
    expect(result.current.dialogProps.view).toMatchObject({
      isOpen: false,
      draftContext: 'Letter B context',
      generating: false,
    });
    expect(tryAdoptLetter).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('hydrates a fresh session when returning from B to A', () => {
    const shared = {
      visit: activeVisit(),
      saving: false,
      beginSaving: vi.fn(() => vi.fn()),
      tryAdoptLetter: vi.fn(() => true),
      scheduleDebouncedSave: vi.fn(),
      flushPendingSaves,
      handleMutationError: vi.fn(() => false),
    };
    const letterA = makeLetter();
    const { result, rerender } = renderHook(
      ({ letter }) => usePhotoDescriptionWorkspace({ ...shared, letter }),
      { initialProps: { letter: letterA } },
    );

    act(() => {
      result.current.sectionProps.onPhotoDescriptionChange('Unsaved A draft');
    });
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        photoDescription: 'Letter B description',
      }),
    });
    rerender({
      letter: makeLetter({
        photoDescription: 'Fresh authoritative A',
      }),
    });

    expect(result.current.sectionProps.photoDescription).toBe(
      'Fresh authoritative A',
    );
  });

  it('rejects a late first-A response after A to B to A navigation', async () => {
    const pending = deferred<{
      letter: Letter;
      describedCount: number;
      photoDescriptionStatus: 'AI_DRAFT';
    }>();
    describePhotoMock.mockReturnValue(pending.promise);
    const tryAdoptLetter = vi.fn(() => true);
    const shared = {
      visit: activeVisit(),
      saving: false,
      beginSaving: vi.fn(() => vi.fn()),
      tryAdoptLetter,
      scheduleDebouncedSave: vi.fn(),
      flushPendingSaves,
      handleMutationError: vi.fn(() => false),
    };
    const { result, rerender } = renderHook(
      ({ letter }) => usePhotoDescriptionWorkspace({ ...shared, letter }),
      { initialProps: { letter: makeLetter() } },
    );

    act(() => {
      result.current.sectionProps.onDescribePhoto();
      result.current.dialogProps.onSubmit();
    });
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        photoDescription: 'Letter B description',
      }),
    });
    rerender({
      letter: makeLetter({
        photoDescription: 'Fresh second-A description',
      }),
    });

    await act(async () => {
      pending.resolve({
        letter: makeLetter({ photoDescription: 'Late first-A description' }),
        describedCount: 1,
        photoDescriptionStatus: 'AI_DRAFT',
      });
      await pending.promise;
    });

    expect(result.current.sectionProps.photoDescription).toBe(
      'Fresh second-A description',
    );
    expect(tryAdoptLetter).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('keeps edit saves and verification transitions source-owned', async () => {
    const letter = makeLetter();
    const saved = makeLetter({ photoDescription: 'Edited description' });
    const tryAdoptLetter = vi.fn(() => true);
    const scheduleDebouncedSave = vi.fn();
    const releaseSaving = vi.fn();
    const beginSaving = vi.fn(() => releaseSaving);
    const flushPendingSavesMock = vi.fn(async () => true);
    verifyPhotoDescriptionMock.mockResolvedValue({
      ...saved,
      photoDescriptionStatus: 'VERIFIED',
    });
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace({
        visit: activeVisit(),
        letter,
        saving: false,
        beginSaving,
        tryAdoptLetter,
        scheduleDebouncedSave,
        flushPendingSaves: flushPendingSavesMock,
        handleMutationError: vi.fn(() => false),
      }),
    );

    act(() => {
      result.current.sectionProps.onPhotoDescriptionChange(
        'Edited description',
      );
    });
    expect(result.current.sectionProps.photoDescription).toBe(
      'Edited description',
    );
    const saveTask = scheduleDebouncedSave.mock.calls[0][0];
    updatePhotoDescriptionMock.mockResolvedValue(saved);
    await act(async () => {
      await saveTask();
    });
    expect(updatePhotoDescriptionMock).toHaveBeenCalledWith(
      'letter-a',
      'Edited description',
      3,
    );
    expect(tryAdoptLetter).toHaveBeenCalledWith(saved);

    act(() => {
      result.current.sectionProps.onVerifyPhotoDescription();
    });
    await waitFor(() => {
      expect(verifyPhotoDescriptionMock).toHaveBeenCalledWith('letter-a', 3);
    });
    expect(beginSaving).toHaveBeenCalledTimes(1);
    expect(flushPendingSavesMock).toHaveBeenCalledTimes(1);
    expect(releaseSaving).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      'Photo description verified',
      'success',
    );
  });

  it('uses the same transition to remove verification', async () => {
    const letter = makeLetter({ photoDescriptionStatus: 'VERIFIED' });
    const updated = makeLetter({ photoDescriptionStatus: 'EDITED' });
    const releaseSaving = vi.fn();
    const beginSaving = vi.fn(() => releaseSaving);
    const tryAdoptLetter = vi.fn(() => true);
    unverifyPhotoDescriptionMock.mockResolvedValue(updated);
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace({
        visit: activeVisit(),
        letter,
        saving: false,
        beginSaving,
        tryAdoptLetter,
        scheduleDebouncedSave: vi.fn(),
        flushPendingSaves,
        handleMutationError: vi.fn(() => false),
      }),
    );

    act(() => {
      result.current.sectionProps.onVerifyPhotoDescription();
    });

    await waitFor(() => {
      expect(unverifyPhotoDescriptionMock).toHaveBeenCalledWith('letter-a', 3);
    });
    expect(verifyPhotoDescriptionMock).not.toHaveBeenCalled();
    expect(tryAdoptLetter).toHaveBeenCalledWith(updated);
    expect(beginSaving).toHaveBeenCalledTimes(1);
    expect(releaseSaving).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      'Photo description verification removed',
      'info',
    );
  });

  it('does not verify when a pending save cannot be flushed', async () => {
    const releaseSaving = vi.fn();
    const handleMutationError = vi.fn(() => false);
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace({
        visit: activeVisit(),
        letter: makeLetter(),
        saving: false,
        beginSaving: vi.fn(() => releaseSaving),
        tryAdoptLetter: vi.fn(() => true),
        scheduleDebouncedSave: vi.fn(),
        flushPendingSaves: vi.fn(async () => false),
        handleMutationError,
      }),
    );

    act(() => {
      result.current.sectionProps.onVerifyPhotoDescription();
    });

    await waitFor(() => {
      expect(releaseSaving).toHaveBeenCalledTimes(1);
    });
    expect(verifyPhotoDescriptionMock).not.toHaveBeenCalled();
    expect(handleMutationError).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('does not adopt an in-flight A edit after navigation to B', async () => {
    const pending = deferred<Letter>();
    updatePhotoDescriptionMock.mockReturnValue(pending.promise);
    const scheduleDebouncedSave = vi.fn();
    const tryAdoptLetter = vi.fn(() => true);
    const shared = {
      visit: activeVisit(),
      saving: false,
      beginSaving: vi.fn(() => vi.fn()),
      tryAdoptLetter,
      scheduleDebouncedSave,
      flushPendingSaves,
      handleMutationError: vi.fn(() => false),
    };
    const { result, rerender } = renderHook(
      ({ letter }) => usePhotoDescriptionWorkspace({ ...shared, letter }),
      { initialProps: { letter: makeLetter() } },
    );

    act(() => {
      result.current.sectionProps.onPhotoDescriptionChange('Edited A');
    });
    const save = scheduleDebouncedSave.mock.calls[0][0];
    const savePromise = save();
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        photoDescription: 'Letter B description',
      }),
    });
    await act(async () => {
      pending.resolve(makeLetter({ photoDescription: 'Saved A' }));
      await savePromise;
    });

    expect(result.current.sectionProps.photoDescription).toBe(
      'Letter B description',
    );
    expect(tryAdoptLetter).not.toHaveBeenCalled();
  });

  it('reports a late first-A save failure to the shared coordinator', async () => {
    const pending = deferred<Letter>();
    updatePhotoDescriptionMock.mockReturnValue(pending.promise);
    const scheduleDebouncedSave = vi.fn();
    const shared = {
      visit: activeVisit(),
      saving: false,
      beginSaving: vi.fn(() => vi.fn()),
      tryAdoptLetter: vi.fn(() => true),
      scheduleDebouncedSave,
      flushPendingSaves,
      handleMutationError: vi.fn(() => false),
    };
    const { result, rerender } = renderHook(
      ({ letter }) => usePhotoDescriptionWorkspace({ ...shared, letter }),
      { initialProps: { letter: makeLetter() } },
    );

    act(() => {
      result.current.sectionProps.onPhotoDescriptionChange('Edited first A');
    });
    const savePromise = scheduleDebouncedSave.mock.calls[0][0]();
    rerender({ letter: makeLetter({ id: 'letter-b' }) });
    rerender({
      letter: makeLetter({ photoDescription: 'Fresh second A' }),
    });

    await act(async () => {
      pending.reject(new Error('late first-A conflict'));
      await expect(savePromise).rejects.toThrow('late first-A conflict');
    });

    expect(result.current.sectionProps.photoDescription).toBe('Fresh second A');
    expect(shared.tryAdoptLetter).not.toHaveBeenCalled();
  });

  it('leaves a current save failure with the shared scheduler', async () => {
    const error = new Error('current save failed');
    const scheduleDebouncedSave = vi.fn();
    updatePhotoDescriptionMock.mockRejectedValue(error);
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace({
        visit: activeVisit(),
        letter: makeLetter(),
        saving: false,
        beginSaving: vi.fn(() => vi.fn()),
        tryAdoptLetter: vi.fn(() => true),
        scheduleDebouncedSave,
        flushPendingSaves,
        handleMutationError: vi.fn(() => false),
      }),
    );

    act(() => {
      result.current.sectionProps.onPhotoDescriptionChange('Current edit');
    });

    await expect(scheduleDebouncedSave.mock.calls[0][0]()).rejects.toBe(error);
  });

  it('routes current-owner failures through the terminal mutation owner', async () => {
    const error = new Error('conflict');
    const handleMutationError = vi.fn(() => true);
    describePhotoMock.mockRejectedValue(error);
    const { result } = renderHook(() =>
      usePhotoDescriptionWorkspace({
        visit: activeVisit(),
        letter: makeLetter(),
        saving: false,
        beginSaving: vi.fn(() => vi.fn()),
        tryAdoptLetter: vi.fn(() => false),
        scheduleDebouncedSave: vi.fn(),
        flushPendingSaves,
        handleMutationError,
      }),
    );

    act(() => {
      result.current.sectionProps.onDescribePhoto();
      result.current.dialogProps.onSubmit();
    });

    await waitFor(() => {
      expect(handleMutationError).toHaveBeenCalledWith(
        error,
        'Failed to describe photo',
      );
    });
    expect(result.current.dialogProps.view.generating).toBe(false);
  });
});
