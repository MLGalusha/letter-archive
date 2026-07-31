import { act, renderHook } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Letter } from '../../../../types/Letter';
import type {
  CancelLetterReviewDebouncedSaves,
  LetterReviewDebouncedSaveOptions,
  ScheduleLetterReviewDebouncedSave,
} from '../useLetterReviewAutosaveCoordinator';
import { useLetterReviewAutosaveCoordinator } from '../useLetterReviewAutosaveCoordinator';
import type { LetterReviewVisit } from '../useLetterReviewVisit';
import { useIdentityAutoSave } from '../useIdentityAutoSave';

const { retagMetadataMock, updateIdentityMock } = vi.hoisted(() => ({
  retagMetadataMock: vi.fn(),
  updateIdentityMock: vi.fn(),
}));

vi.mock('../../../../api/admin/letters', () => ({
  retagMetadata: retagMetadataMock,
  updateIdentity: updateIdentityMock,
}));

interface ScheduledSave {
  task: () => Promise<void>;
  options: LetterReviewDebouncedSaveOptions;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function makeVisit(letterId: string) {
  let active = true;
  const value: LetterReviewVisit = {
    letterId,
    isActive: () => active,
  };
  return {
    value,
    deactivate: () => {
      active = false;
    },
  };
}

function makeLetter(
  id: string,
  overrides: Partial<Letter> = {},
): Letter {
  return {
    id,
    title: `Letter ${id}`,
    primarySourceRevision: 3,
    images: [],
    transcript: { pages: [], fullText: '', verified: false },
    metadata: {
      verified: false,
      sender: `${id} sender`,
      recipient: `${id} recipient`,
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

function makeHarness(options: {
  initialVisit: LetterReviewVisit;
  initialLetter: Letter;
  tryAdoptLetter?: (letter: Letter) => boolean;
}) {
  const scheduled: ScheduledSave[] = [];
  const scheduleDebouncedSave: ScheduleLetterReviewDebouncedSave = vi.fn(
    (task, saveOptions) => {
      scheduled.push({ task, options: saveOptions });
    },
  );
  const cancelDebouncedSaves: CancelLetterReviewDebouncedSaves = vi.fn();
  const tryAdoptLetter = vi.fn(
    options.tryAdoptLetter ?? (() => true),
  );
  const syncIdentityMetadata = vi.fn();
  const hook = renderHook(
    ({
      visit,
      letter,
      mutationsBlocked,
    }: {
      visit: LetterReviewVisit;
      letter: Letter;
      mutationsBlocked: boolean;
    }) => useIdentityAutoSave({
      visit,
      letter,
      tryAdoptLetter,
      scheduleDebouncedSave,
      cancelDebouncedSaves,
      mutationsBlocked,
      syncIdentityMetadata,
    }),
    {
      initialProps: {
        visit: options.initialVisit,
        letter: options.initialLetter,
        mutationsBlocked: false,
      },
    },
  );

  return {
    ...hook,
    cancelDebouncedSaves,
    scheduled,
    scheduledInLane: (lane: LetterReviewDebouncedSaveOptions['lane']) => (
      scheduled.filter((save) => save.options.lane === lane)
    ),
    syncIdentityMetadata,
    tryAdoptLetter,
  };
}

describe('useIdentityAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps A and B payloads isolated while stale A work finishes', async () => {
    const visitA = makeVisit('letter-a');
    const visitB = makeVisit('letter-b');
    const letterA = makeLetter('letter-a');
    const letterB = makeLetter('letter-b');
    const updatedA = makeLetter('letter-a', {
      metadata: {
        ...letterA.metadata,
        sender: 'Updated A',
      },
    });
    const updatedB = makeLetter('letter-b', {
      metadata: {
        ...letterB.metadata,
        recipient: 'Updated B',
      },
    });
    updateIdentityMock.mockImplementation(async (id: string) => (
      id === 'letter-a' ? updatedA : updatedB
    ));
    retagMetadataMock.mockImplementation(async (id: string) => (
      id === 'letter-a' ? updatedA : updatedB
    ));
    const harness = makeHarness({
      initialVisit: visitA.value,
      initialLetter: letterA,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Updated A',
      });
    });
    const saveA = harness.scheduledInLane('identity')[0];

    visitA.deactivate();
    harness.rerender({
      visit: visitB.value,
      letter: letterB,
      mutationsBlocked: false,
    });
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        recipient: 'Updated B',
      });
    });
    const saveB = harness.scheduledInLane('identity')[1];

    await act(async () => {
      await saveA.task();
    });
    expect(updateIdentityMock).toHaveBeenNthCalledWith(
      1,
      'letter-a',
      {
        primarySourceRevision: 3,
        expectedSender: 'letter-a sender',
        sender: 'Updated A',
      },
    );
    expect(harness.tryAdoptLetter).not.toHaveBeenCalled();
    expect(harness.syncIdentityMetadata).not.toHaveBeenCalled();
    expect(harness.result.current.identityUpdateState).toBe('pending');
    expect(harness.result.current.identityUpdateSecondsRemaining).toBe(10);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(harness.result.current.identityUpdateSecondsRemaining).toBe(9);

    await act(async () => {
      await saveB.task();
    });
    expect(updateIdentityMock).toHaveBeenNthCalledWith(
      2,
      'letter-b',
      {
        primarySourceRevision: 3,
        expectedRecipient: 'letter-b recipient',
        recipient: 'Updated B',
      },
    );
    expect(harness.tryAdoptLetter).toHaveBeenCalledWith(updatedB);
    expect(harness.syncIdentityMetadata).toHaveBeenCalledWith(updatedB);
  });

  it('rejects A-to-B-to-A side effects from the first A visit', async () => {
    const firstA = makeVisit('letter-a');
    const visitB = makeVisit('letter-b');
    const freshA = makeVisit('letter-a');
    const letterA = makeLetter('letter-a');
    const updatedA = makeLetter('letter-a', {
      metadata: { ...letterA.metadata, sender: 'Updated A' },
    });
    updateIdentityMock.mockResolvedValue(updatedA);
    retagMetadataMock.mockResolvedValue(updatedA);
    const harness = makeHarness({
      initialVisit: firstA.value,
      initialLetter: letterA,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Updated A',
      });
    });
    const staleSave = harness.scheduledInLane('identity')[0];

    firstA.deactivate();
    harness.rerender({
      visit: visitB.value,
      letter: makeLetter('letter-b'),
      mutationsBlocked: false,
    });
    visitB.deactivate();
    harness.rerender({
      visit: freshA.value,
      letter: letterA,
      mutationsBlocked: false,
    });

    await act(async () => {
      await staleSave.task();
    });

    expect(updateIdentityMock).toHaveBeenCalledTimes(1);
    expect(retagMetadataMock).toHaveBeenCalledTimes(1);
    expect(harness.tryAdoptLetter).not.toHaveBeenCalled();
    expect(harness.syncIdentityMetadata).not.toHaveBeenCalled();
    expect(harness.result.current).toMatchObject({
      identityUpdateState: 'idle',
      identityUpdateSecondsRemaining: 0,
      retagState: 'idle',
    });
  });

  it('does not merge queued intent from an earlier visit to the same target', async () => {
    const firstA = makeVisit('letter-a');
    const freshA = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const updated = makeLetter('letter-a', {
      metadata: {
        ...letter.metadata,
        recipient: 'Fresh recipient',
      },
    });
    updateIdentityMock.mockResolvedValue(updated);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: firstA.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'First-visit sender',
      });
    });
    const firstVisitTask = harness.scheduledInLane('identity')[0].task;

    firstA.deactivate();
    harness.rerender({
      visit: freshA.value,
      letter,
      mutationsBlocked: false,
    });
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        recipient: 'Fresh recipient',
      });
    });

    await act(async () => {
      await harness.scheduledInLane('identity')[1].task();
      await firstVisitTask();
    });

    expect(updateIdentityMock).toHaveBeenCalledTimes(1);
    expect(updateIdentityMock).toHaveBeenCalledWith('letter-a', {
      primarySourceRevision: 3,
      expectedRecipient: 'letter-a recipient',
      recipient: 'Fresh recipient',
    });
  });

  it('does not restore a failed first-A field into a fresh A visit', async () => {
    const firstA = makeVisit('letter-a');
    const visitB = makeVisit('letter-b');
    const freshA = makeVisit('letter-a');
    const letterA = makeLetter('letter-a');
    const firstResult = deferred<Letter>();
    const failure = new Error('stale first-A save failed');
    const updated = makeLetter('letter-a', {
      metadata: {
        ...letterA.metadata,
        recipient: 'Fresh recipient',
      },
    });
    updateIdentityMock
      .mockReturnValueOnce(firstResult.promise)
      .mockResolvedValueOnce(updated);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: firstA.value,
      initialLetter: letterA,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Abandoned sender',
      });
    });
    let staleSave!: Promise<void>;
    act(() => {
      staleSave = harness.scheduledInLane('identity')[0].task();
    });

    firstA.deactivate();
    harness.rerender({
      visit: visitB.value,
      letter: makeLetter('letter-b'),
      mutationsBlocked: false,
    });
    visitB.deactivate();
    harness.rerender({
      visit: freshA.value,
      letter: letterA,
      mutationsBlocked: false,
    });
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        recipient: 'Fresh recipient',
      });
    });

    await act(async () => {
      firstResult.reject(failure);
      await expect(staleSave).rejects.toBe(failure);
    });
    await act(async () => {
      await harness.scheduledInLane('identity')[1].task();
    });

    expect(updateIdentityMock).toHaveBeenNthCalledWith(
      2,
      'letter-a',
      {
        primarySourceRevision: 3,
        expectedRecipient: 'letter-a recipient',
        recipient: 'Fresh recipient',
      },
    );
  });

  it('coalesces sender and recipient into one identity transaction', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const updated = makeLetter('letter-a', {
      metadata: {
        ...letter.metadata,
        sender: 'New sender',
        recipient: 'New recipient',
      },
    });
    updateIdentityMock.mockResolvedValue(updated);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'New sender',
      });
      harness.result.current.scheduleIdentityUpdate({
        recipient: 'New recipient',
      });
    });
    expect(harness.scheduled).toHaveLength(2);

    await act(async () => {
      await harness.scheduledInLane('identity')[1].task();
    });

    expect(updateIdentityMock).toHaveBeenCalledTimes(1);
    expect(updateIdentityMock).toHaveBeenCalledWith('letter-a', {
      primarySourceRevision: 3,
      expectedSender: 'letter-a sender',
      sender: 'New sender',
      expectedRecipient: 'letter-a recipient',
      recipient: 'New recipient',
    });
    expect(retagMetadataMock).toHaveBeenCalledWith('letter-a', {
      primarySourceRevision: 3,
      field: 'both',
      oldSender: 'letter-a sender',
      newSender: 'New sender',
      oldRecipient: 'letter-a recipient',
      newRecipient: 'New recipient',
    });
  });

  it('repairs a committed identity before advancing to the next identity', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const firstResult = deferred<Letter>();
    const updatedA = makeLetter('letter-a', {
      metadata: { ...letter.metadata, sender: 'Sender A' },
    });
    const updatedB = makeLetter('letter-a', {
      metadata: { ...letter.metadata, sender: 'Sender B' },
    });
    const order: string[] = [];
    let persistedSender = letter.metadata.sender;
    updateIdentityMock
      .mockImplementationOnce(async () => {
        order.push('identity:Sender A');
        const updated = await firstResult.promise;
        persistedSender = updated.metadata.sender;
        return updated;
      })
      .mockImplementationOnce(async () => {
        order.push('identity:Sender B');
        persistedSender = updatedB.metadata.sender;
        return updatedB;
      });
    retagMetadataMock.mockImplementation(async (
      _letterId: string,
      change: { oldSender?: string | null; newSender?: string | null },
    ) => {
      order.push(`retag:${change.oldSender}->${change.newSender}`);
      expect(persistedSender).toBe(change.newSender);
      return change.newSender === 'Sender A' ? updatedA : updatedB;
    });
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Sender A',
      });
    });
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = harness.scheduledInLane('identity')[0].task();
    });
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Sender B',
      });
    });

    await act(async () => {
      firstResult.resolve(updatedA);
      await firstSave;
      await harness.scheduledInLane('identity')[1].task();
    });

    expect(order).toEqual([
      'identity:Sender A',
      'retag:letter-a sender->Sender A',
      'identity:Sender B',
      'retag:Sender A->Sender B',
    ]);
  });

  it('rebases a newer pending edit after an in-flight update succeeds', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const firstResult = deferred<Letter>();
    const firstUpdated = makeLetter('letter-a', {
      primarySourceRevision: 4,
      metadata: {
        ...letter.metadata,
        sender: 'Canonical sender',
      },
    });
    const secondUpdated = makeLetter('letter-a', {
      primarySourceRevision: 4,
      metadata: {
        ...letter.metadata,
        sender: 'Newest sender',
        recipient: 'Newest recipient',
      },
    });
    updateIdentityMock
      .mockReturnValueOnce(firstResult.promise)
      .mockResolvedValueOnce(secondUpdated);
    retagMetadataMock
      .mockResolvedValueOnce(firstUpdated)
      .mockResolvedValueOnce(secondUpdated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'First sender',
      });
    });
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = harness.scheduledInLane('identity')[0].task();
    });
    expect(harness.result.current.identityUpdateState).toBe('saving');

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Newest sender',
        recipient: 'Newest recipient',
      });
    });
    const secondSave = harness.scheduledInLane('identity')[1];

    await act(async () => {
      firstResult.resolve(firstUpdated);
      await firstSave;
    });
    expect(harness.tryAdoptLetter).toHaveBeenNthCalledWith(
      1,
      firstUpdated,
    );
    expect(harness.syncIdentityMetadata).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          sender: 'Newest sender',
          recipient: 'Newest recipient',
        }),
      }),
    );
    await act(async () => {
      await secondSave.task();
    });

    expect(updateIdentityMock).toHaveBeenNthCalledWith(
      2,
      'letter-a',
      {
        primarySourceRevision: 4,
        expectedSender: 'Canonical sender',
        sender: 'Newest sender',
        expectedRecipient: 'letter-a recipient',
        recipient: 'Newest recipient',
      },
    );
  });

  it('drops a queued retry when the accepted response already satisfies it', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const firstResult = deferred<Letter>();
    const updated = makeLetter('letter-a', {
      primarySourceRevision: 4,
      metadata: {
        ...letter.metadata,
        sender: 'Canonical sender',
      },
    });
    updateIdentityMock.mockReturnValue(firstResult.promise);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Predicted sender',
      });
    });
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = harness.scheduledInLane('identity')[0].task();
    });
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Canonical sender',
      });
    });

    await act(async () => {
      firstResult.resolve(updated);
      await firstSave;
    });
    act(() => {
      harness.result.current.retryPendingIdentityWork();
    });

    expect(harness.cancelDebouncedSaves).toHaveBeenCalledWith([
      'identity',
    ]);
    expect(harness.scheduledInLane('identity')).toHaveLength(2);
    expect(updateIdentityMock).toHaveBeenCalledTimes(1);
  });

  it('rebases queued intent to persisted values when the in-flight update fails', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const firstResult = deferred<Letter>();
    const failure = new Error('temporary identity failure');
    const secondUpdated = makeLetter('letter-a', {
      metadata: {
        ...letter.metadata,
        sender: 'Newest sender',
        recipient: 'Newest recipient',
      },
    });
    updateIdentityMock
      .mockReturnValueOnce(firstResult.promise)
      .mockResolvedValueOnce(secondUpdated);
    retagMetadataMock.mockResolvedValue(secondUpdated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Predicted sender',
      });
    });
    let firstSave!: Promise<void>;
    act(() => {
      firstSave = harness.scheduledInLane('identity')[0].task();
    });
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Newest sender',
        recipient: 'Newest recipient',
      });
    });

    await act(async () => {
      firstResult.reject(failure);
      await expect(firstSave).rejects.toBe(failure);
    });
    await act(async () => {
      await harness.scheduledInLane('identity')[1].task();
    });

    expect(updateIdentityMock).toHaveBeenNthCalledWith(
      2,
      'letter-a',
      {
        primarySourceRevision: 3,
        expectedSender: 'letter-a sender',
        sender: 'Newest sender',
        expectedRecipient: 'letter-a recipient',
        recipient: 'Newest recipient',
      },
    );
  });

  it('keeps a failed identity field in a later partial identity edit', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const failure = new Error('sender failed');
    const updated = makeLetter('letter-a', {
      metadata: {
        ...letter.metadata,
        sender: 'Recovered sender',
        recipient: 'New recipient',
      },
    });
    updateIdentityMock
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(updated);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Recovered sender',
      });
    });
    await act(async () => {
      await expect(
        harness.scheduledInLane('identity')[0].task(),
      ).rejects.toBe(failure);
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        recipient: 'New recipient',
      });
    });
    await act(async () => {
      await harness.scheduledInLane('identity')[1].task();
    });

    expect(updateIdentityMock).toHaveBeenNthCalledWith(
      2,
      'letter-a',
      {
        primarySourceRevision: 3,
        expectedSender: 'letter-a sender',
        sender: 'Recovered sender',
        expectedRecipient: 'letter-a recipient',
        recipient: 'New recipient',
      },
    );
  });

  it('keeps failed identity work pending until an explicit retry succeeds', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const failure = new Error('temporary identity failure');
    const updated = makeLetter('letter-a', {
      metadata: {
        ...letter.metadata,
        sender: 'Recovered sender',
      },
    });
    updateIdentityMock
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(updated);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Recovered sender',
      });
    });
    await act(async () => {
      await expect(
        harness.scheduledInLane('identity')[0].task(),
      ).rejects.toBe(failure);
    });

    expect(harness.result.current.hasPendingIdentityWork()).toBe(true);

    act(() => {
      harness.result.current.retryPendingIdentityWork();
    });
    await act(async () => {
      await harness.scheduledInLane('identity')[1].task();
    });

    expect(updateIdentityMock).toHaveBeenCalledTimes(2);
    expect(harness.result.current.hasPendingIdentityWork()).toBe(false);
  });

  it('cancels the identity lane when the pending edit returns to baseline', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Temporary sender',
      });
    });
    const canceledTask = harness.scheduled[0].task;
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'letter-a sender',
      });
    });

    expect(harness.cancelDebouncedSaves).toHaveBeenCalledWith([
      'identity',
    ]);
    expect(harness.result.current).toMatchObject({
      identityUpdateState: 'idle',
      identityUpdateSecondsRemaining: 0,
      retagState: 'idle',
    });
    await act(async () => {
      await canceledTask();
      await harness.scheduledInLane('identity')[1].task();
    });
    expect(updateIdentityMock).not.toHaveBeenCalled();
  });

  it('clears a failed identity lane when the edit returns to baseline', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const failure = new Error('temporary identity failure');
    const handleMutationError = vi.fn(() => false);
    updateIdentityMock.mockRejectedValueOnce(failure);

    const { result } = renderHook(() => {
      const coordinator = useLetterReviewAutosaveCoordinator({
        visit: owner.value,
        targetKey: `${letter.id}:${letter.primarySourceRevision}`,
        isMutationBlocked: () => false,
        mutationsBlocked: false,
        handleMutationError,
      });
      const identity = useIdentityAutoSave({
        visit: owner.value,
        letter,
        tryAdoptLetter: () => true,
        scheduleDebouncedSave: coordinator.scheduleDebouncedSave,
        cancelDebouncedSaves: coordinator.cancelDebouncedSaves,
        mutationsBlocked: false,
        syncIdentityMetadata: vi.fn(),
      });
      return {
        ...identity,
        flush: () => coordinator.flushDebouncedSaves(['identity']),
      };
    });

    act(() => {
      result.current.scheduleIdentityUpdate({
        sender: 'Temporary sender',
      });
    });
    let failedFlush!: Promise<boolean>;
    act(() => {
      failedFlush = result.current.flush();
    });
    await act(async () => {
      await expect(failedFlush).resolves.toBe(false);
    });

    act(() => {
      result.current.scheduleIdentityUpdate({
        sender: 'letter-a sender',
      });
    });
    let recoveredFlush!: Promise<boolean>;
    act(() => {
      recoveredFlush = result.current.flush();
    });
    await act(async () => {
      await expect(recoveredFlush).resolves.toBe(true);
    });

    expect(updateIdentityMock).toHaveBeenCalledTimes(1);
  });

  it('owns countdown, saving, and retag states for the active visit', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const identityResult = deferred<Letter>();
    const retagResult = deferred<Letter>();
    const updated = makeLetter('letter-a', {
      metadata: { ...letter.metadata, sender: 'New sender' },
    });
    updateIdentityMock.mockReturnValue(identityResult.promise);
    retagMetadataMock.mockReturnValue(retagResult.promise);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'New sender',
      });
    });
    expect(harness.result.current).toMatchObject({
      identityUpdateState: 'pending',
      identityUpdateSecondsRemaining: 10,
      retagState: 'idle',
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      harness.result.current.identityUpdateSecondsRemaining,
    ).toBe(9);

    let save!: Promise<void>;
    act(() => {
      save = harness.scheduledInLane('identity')[0].task();
    });
    expect(harness.result.current).toMatchObject({
      identityUpdateState: 'saving',
      identityUpdateSecondsRemaining: 0,
    });

    await act(async () => {
      identityResult.resolve(updated);
      await identityResult.promise;
    });
    expect(harness.result.current).toMatchObject({
      identityUpdateState: 'idle',
      retagState: 'retagging',
    });

    await act(async () => {
      retagResult.resolve(updated);
      await save;
    });
    expect(harness.result.current.retagState).toBe('done');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(harness.result.current.retagState).toBe('idle');
  });

  it('never syncs a response that guarded adoption rejects', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const updated = makeLetter('letter-a', {
      metadata: { ...letter.metadata, sender: 'New sender' },
    });
    updateIdentityMock.mockResolvedValue(updated);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
      tryAdoptLetter: () => false,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'New sender',
      });
    });
    await act(async () => {
      await harness.scheduledInLane('identity')[0].task();
    });

    expect(harness.tryAdoptLetter).toHaveBeenCalledTimes(2);
    expect(harness.syncIdentityMetadata).not.toHaveBeenCalled();
    expect(harness.result.current.identityUpdateState).toBe('idle');
    expect(harness.result.current.retagState).toBe('idle');
  });

  it('finishes the retag continuation after the hook unmounts', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const identityResult = deferred<Letter>();
    const updated = makeLetter('letter-a', {
      metadata: { ...letter.metadata, sender: 'New sender' },
    });
    updateIdentityMock.mockReturnValue(identityResult.promise);
    retagMetadataMock.mockResolvedValue(updated);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'New sender',
      });
    });
    let save!: Promise<void>;
    act(() => {
      save = harness.scheduledInLane('identity')[0].task();
    });
    harness.unmount();

    await act(async () => {
      identityResult.resolve(updated);
      await save;
    });

    expect(retagMetadataMock).toHaveBeenCalledWith(
      'letter-a',
      expect.objectContaining({
        oldSender: 'letter-a sender',
        newSender: 'New sender',
      }),
    );
  });

  it('retries a failed retag without replaying the committed identity save', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const updated = makeLetter('letter-a', {
      metadata: { ...letter.metadata, sender: 'New sender' },
    });
    const retagError = new Error('retag failed');
    updateIdentityMock.mockResolvedValue(updated);
    retagMetadataMock.mockRejectedValue(retagError);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'New sender',
      });
    });
    await act(async () => {
      await expect(
        harness.scheduledInLane('identity')[0].task(),
      ).rejects.toBe(retagError);
    });

    expect(harness.scheduledInLane('identity')[0].options)
      .toMatchObject({
        errorMessage: 'Failed to save name and update metadata references',
      });
    expect(harness.result.current).toMatchObject({
      identityUpdateState: 'idle',
      retagState: 'idle',
    });
    expect(harness.result.current.hasPendingIdentityWork()).toBe(true);

    retagMetadataMock.mockResolvedValue(updated);
    act(() => {
      harness.result.current.retryPendingIdentityWork();
    });
    await act(async () => {
      await harness.scheduledInLane('identity')[1].task();
    });

    expect(updateIdentityMock).toHaveBeenCalledTimes(1);
    expect(retagMetadataMock).toHaveBeenCalledTimes(2);
    expect(harness.result.current.retagState).toBe('done');
    expect(harness.result.current.hasPendingIdentityWork()).toBe(false);
  });

  it('clears a newer countdown when its prerequisite retag fails', async () => {
    const owner = makeVisit('letter-a');
    const letter = makeLetter('letter-a');
    const updated = makeLetter('letter-a', {
      metadata: { ...letter.metadata, sender: 'Sender A' },
    });
    const retagError = new Error('retag still unavailable');
    updateIdentityMock.mockResolvedValue(updated);
    retagMetadataMock.mockRejectedValue(retagError);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: letter,
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Sender A',
      });
    });
    await act(async () => {
      await expect(
        harness.scheduledInLane('identity')[0].task(),
      ).rejects.toBe(retagError);
    });
    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'Sender B',
      });
    });
    expect(harness.result.current.identityUpdateState).toBe('pending');

    await act(async () => {
      await expect(
        harness.scheduledInLane('identity')[1].task(),
      ).rejects.toBe(retagError);
    });

    expect(updateIdentityMock).toHaveBeenCalledTimes(1);
    expect(harness.result.current).toMatchObject({
      identityUpdateState: 'idle',
      identityUpdateSecondsRemaining: 0,
      retagState: 'idle',
    });
  });

  it('delegates identity errors to the scheduler with the identity message', async () => {
    const owner = makeVisit('letter-a');
    const error = new Error('identity failed');
    updateIdentityMock.mockRejectedValue(error);
    const harness = makeHarness({
      initialVisit: owner.value,
      initialLetter: makeLetter('letter-a'),
    });

    act(() => {
      harness.result.current.scheduleIdentityUpdate({
        sender: 'New sender',
      });
    });

    expect(harness.scheduledInLane('identity')[0].options).toMatchObject({
      lane: 'identity',
      delayMs: 10_000,
      errorMessage: 'Failed to save name and update metadata references',
    });
    await act(async () => {
      await expect(
        harness.scheduledInLane('identity')[0].task(),
      ).rejects.toBe(error);
    });
    expect(harness.result.current.identityUpdateState).toBe('idle');
  });
});
