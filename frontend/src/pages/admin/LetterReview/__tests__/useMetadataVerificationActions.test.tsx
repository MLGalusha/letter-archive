import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Letter } from '../../../../types/Letter';
import type { ExecuteLetterReviewMutation } from '../useLetterReviewMutationExecutor';
import { useMetadataVerificationActions } from '../useMetadataVerificationActions';
import type { LetterReviewVisit } from '../useLetterReviewVisit';

const { unverifyMetadataMock, verifyMetadataMock } = vi.hoisted(() => ({
  unverifyMetadataMock: vi.fn(),
  verifyMetadataMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  unverifyMetadata: unverifyMetadataMock,
  verifyMetadata: verifyMetadataMock,
}));

function makeLetter(
  overrides: Partial<Letter> = {},
): Letter {
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
    ...overrides,
  };
}

function adoptedExecutor(events: string[] = []): ExecuteLetterReviewMutation {
  const execute: ExecuteLetterReviewMutation = async (mutation) => {
    const response = await mutation.request();
    events.push('hydrate');
    mutation.afterAdopt?.(response);
  };
  return vi.fn(execute);
}

function activeVisit(letterId = 'letter-a'): LetterReviewVisit {
  return {
    letterId,
    isActive: () => true,
  };
}

describe('useMetadataVerificationActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates revision-bound verification and success feedback to the executor', async () => {
    const letter = makeLetter();
    verifyMetadataMock.mockResolvedValue({
      ...letter,
      metadataContentStatus: 'VERIFIED',
    });
    const events: string[] = [];
    verifyMetadataMock.mockImplementation(async () => {
      events.push('request');
      return {
        ...letter,
        metadataContentStatus: 'VERIFIED',
      };
    });
    const executeLetterMutation = adoptedExecutor(events);
    const showToast = vi.fn(() => events.push('toast'));
    const { result } = renderHook(() =>
      useMetadataVerificationActions({
        visit: activeVisit(),
        letter,
        executeLetterMutation,
        showToast,
      }),
    );

    await act(async () => {
      await result.current.handleVerifyMetadata();
    });

    expect(verifyMetadataMock).toHaveBeenCalledWith('letter-a', 7);
    expect(executeLetterMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        failureMessage: 'Failed to verify metadata',
      }),
    );
    expect(events).toEqual(['request', 'hydrate', 'toast']);
    expect(showToast).toHaveBeenCalledWith('Metadata verified', 'success');
  });

  it('shows the edit tooltip only for verified metadata', () => {
    const executeLetterMutation = adoptedExecutor();
    const showToast = vi.fn();
    const visit = activeVisit();
    const { result, rerender } = renderHook(
      ({ letter }) => useMetadataVerificationActions({
        visit,
        letter,
        executeLetterMutation,
        showToast,
      }),
      { initialProps: { letter: makeLetter() } },
    );

    act(() => {
      result.current.handleMetadataFieldClick({
        clientX: 12,
        clientY: 34,
      } as MouseEvent);
    });
    expect(result.current.showMetadataTooltip).toBe(false);

    rerender({
      letter: makeLetter({ metadataContentStatus: 'VERIFIED' }),
    });
    act(() => {
      result.current.handleMetadataFieldClick({
        clientX: 12,
        clientY: 34,
      } as MouseEvent);
    });

    expect(result.current.showMetadataTooltip).toBe(true);
    expect(result.current.metadataTooltipPosition).toEqual({ x: 12, y: 34 });
  });

  it('closes the tooltip and delegates revision-bound unverification', async () => {
    const letter = makeLetter({
      metadataContentStatus: 'VERIFIED',
      metadata: { verified: true },
    });
    unverifyMetadataMock.mockResolvedValue({
      ...letter,
      metadataContentStatus: 'EDITED',
    });
    const executeLetterMutation = adoptedExecutor();
    const showToast = vi.fn();
    const visit = activeVisit();
    const { result } = renderHook(() =>
      useMetadataVerificationActions({
        visit,
        letter,
        executeLetterMutation,
        showToast,
      }),
    );

    act(() => {
      result.current.handleMetadataFieldClick({
        clientX: 12,
        clientY: 34,
      } as MouseEvent);
    });
    expect(result.current.showMetadataTooltip).toBe(true);

    await act(async () => {
      await result.current.handleMetadataFieldDoubleClick();
    });

    expect(result.current.showMetadataTooltip).toBe(false);
    expect(unverifyMetadataMock).toHaveBeenCalledWith('letter-a', 7);
    expect(executeLetterMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        failureMessage: 'Failed to unverify metadata',
      }),
    );
    expect(showToast).toHaveBeenCalledWith('Verification removed', 'info');
  });

  it('leaves blocked or rejected work silent and does not call the request itself', async () => {
    const letter = makeLetter();
    const executeLetterMutation = vi.fn<ExecuteLetterReviewMutation>(
      async () => {},
    );
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useMetadataVerificationActions({
        visit: activeVisit(),
        letter,
        executeLetterMutation,
        showToast,
      }),
    );

    await act(async () => {
      await result.current.handleVerifyMetadata();
    });

    expect(executeLetterMutation).toHaveBeenCalledTimes(1);
    expect(verifyMetadataMock).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('captures the click-time target before queued work runs', async () => {
    const letter = makeLetter();
    let capturedMutation:
      | Parameters<ExecuteLetterReviewMutation>[0]
      | undefined;
    const executeLetterMutation = vi.fn<ExecuteLetterReviewMutation>(
      async (mutation) => {
        capturedMutation = mutation;
      },
    );
    const { result, rerender } = renderHook(
      ({ letter }) => useMetadataVerificationActions({
        visit: activeVisit(letter.id),
        letter,
        executeLetterMutation,
        showToast: vi.fn(),
      }),
      { initialProps: { letter } },
    );

    await act(async () => {
      await result.current.handleVerifyMetadata();
    });
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        primarySourceRevision: 12,
      }),
    });
    verifyMetadataMock.mockResolvedValue(letter);

    await capturedMutation?.request();

    expect(verifyMetadataMock).toHaveBeenCalledWith('letter-a', 7);
  });

  it('resets route-owned tooltip state and ignores captured stale handlers', async () => {
    let firstVisitActive = true;
    const firstVisit: LetterReviewVisit = {
      letterId: 'letter-a',
      isActive: () => firstVisitActive,
    };
    const secondVisit = activeVisit('letter-b');
    const executeLetterMutation = vi.fn<ExecuteLetterReviewMutation>();
    const { result, rerender } = renderHook(
      ({ letter, visit }) => useMetadataVerificationActions({
        visit,
        letter,
        executeLetterMutation,
        showToast: vi.fn(),
      }),
      {
        initialProps: {
          letter: makeLetter({ metadataContentStatus: 'VERIFIED' }),
          visit: firstVisit,
        },
      },
    );

    act(() => {
      result.current.handleMetadataFieldClick({
        clientX: 12,
        clientY: 34,
      } as MouseEvent);
    });
    const staleClick = result.current.handleMetadataFieldClick;
    const staleDoubleClick = result.current.handleMetadataFieldDoubleClick;
    expect(result.current.showMetadataTooltip).toBe(true);

    firstVisitActive = false;
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        metadataContentStatus: 'VERIFIED',
      }),
      visit: secondVisit,
    });
    expect(result.current.showMetadataTooltip).toBe(false);

    act(() => {
      staleClick({
        clientX: 56,
        clientY: 78,
      } as MouseEvent);
    });
    await act(async () => {
      await staleDoubleClick();
    });

    expect(result.current.showMetadataTooltip).toBe(false);
    expect(executeLetterMutation).not.toHaveBeenCalled();
  });

  it('does nothing without an authoritative letter or verified state', async () => {
    const executeLetterMutation = vi.fn<ExecuteLetterReviewMutation>();
    const visit = activeVisit();
    const { result, rerender } = renderHook(
      ({ letter }) => useMetadataVerificationActions({
        visit,
        letter,
        executeLetterMutation,
        showToast: vi.fn(),
      }),
      { initialProps: { letter: null as Letter | null } },
    );

    await act(async () => {
      await result.current.handleVerifyMetadata();
      await result.current.handleMetadataFieldDoubleClick();
    });
    rerender({ letter: makeLetter() });
    await act(async () => {
      await result.current.handleMetadataFieldDoubleClick();
    });

    expect(executeLetterMutation).not.toHaveBeenCalled();
    expect(verifyMetadataMock).not.toHaveBeenCalled();
    expect(unverifyMetadataMock).not.toHaveBeenCalled();
  });
});
