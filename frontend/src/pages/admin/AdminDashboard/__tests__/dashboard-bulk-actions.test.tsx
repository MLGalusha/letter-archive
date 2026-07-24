import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../api/client';
import { useDashboardBulkActions } from '../useDashboardBulkActions';

const {
  bulkClearMetadataMock,
  bulkClearTranscriptionsMock,
  bulkUpdateContentVisibilityMock,
  deleteLetterMock,
  showToastMock,
} = vi.hoisted(() => ({
  bulkClearMetadataMock: vi.fn(),
  bulkClearTranscriptionsMock: vi.fn(),
  bulkUpdateContentVisibilityMock: vi.fn(),
  deleteLetterMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  bulkClearMetadata: bulkClearMetadataMock,
  bulkClearTranscriptions: bulkClearTranscriptionsMock,
  bulkUpdateContentVisibility: bulkUpdateContentVisibilityMock,
}));

vi.mock('../../../../api/letters', () => ({
  deleteLetter: deleteLetterMock,
}));

vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function renderBulkActions(selectedSources = [
  { letterId: 'letter-1', primarySourceRevision: 4 },
  { letterId: 'letter-2', primarySourceRevision: 9 },
]) {
  const selectedIds = new Set(['letter-1', 'letter-2']);
  const setSelectedIds = vi.fn();
  const exitEditMode = vi.fn();
  const fetchLetters = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() => useDashboardBulkActions({
    selectedIds,
    selectedSources,
    setSelectedIds,
    exitEditMode,
    fetchLetters,
  }));

  return { ...hook, exitEditMode, fetchLetters, setSelectedIds };
}

describe('useDashboardBulkActions source-bound mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkClearMetadataMock.mockResolvedValue({
      requested: 2,
      applied: 2,
      skipped: 0,
      skipReasons: [],
    });
    bulkClearTranscriptionsMock.mockResolvedValue({
      requested: 2,
      applied: 2,
      skipped: 0,
      skipReasons: [],
    });
    deleteLetterMock.mockResolvedValue(undefined);
  });

  it('reports the applied count for a partial grant and refreshes the dashboard', async () => {
    bulkUpdateContentVisibilityMock.mockResolvedValueOnce({
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-2',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
      }],
    });
    const { result, fetchLetters } = renderBulkActions();

    await act(async () => {
      await result.current.handleBulkPublish();
    });

    expect(bulkUpdateContentVisibilityMock).toHaveBeenCalledWith(
      [
        { letterId: 'letter-1', primarySourceRevision: 4 },
        { letterId: 'letter-2', primarySourceRevision: 9 },
      ],
      'PUBLISH_LETTER',
    );
    expect(showToastMock).toHaveBeenCalledWith(
      'Published 1 letter; skipped 1 because the content changed or is no longer eligible',
      'info',
    );
    expect(showToastMock).not.toHaveBeenCalledWith(
      expect.stringContaining('Published 2 letters'),
      expect.anything(),
    );
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('publishes only with revisions retained from the selected rows', async () => {
    bulkUpdateContentVisibilityMock.mockResolvedValueOnce({
      requested: 2,
      applied: 2,
      skipped: 0,
      skipReasons: [],
    });
    const { result } = renderBulkActions([
      { letterId: 'letter-1', primarySourceRevision: 14 },
      { letterId: 'letter-2', primarySourceRevision: 19 },
    ]);

    await act(async () => {
      await result.current.handleBulkPublish();
    });

    expect(bulkUpdateContentVisibilityMock).toHaveBeenCalledWith(
      [
        { letterId: 'letter-1', primarySourceRevision: 14 },
        { letterId: 'letter-2', primarySourceRevision: 19 },
      ],
      'PUBLISH_LETTER',
    );
  });

  it('reports zero applied grants as an error and still refreshes source state', async () => {
    bulkUpdateContentVisibilityMock.mockResolvedValueOnce({
      requested: 2,
      applied: 0,
      skipped: 2,
      skipReasons: [
        {
          letterId: 'letter-1',
          code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        },
        {
          letterId: 'letter-2',
          code: 'SOURCE_CHANGED_OR_INELIGIBLE',
        },
      ],
    });
    const { result, fetchLetters } = renderBulkActions();

    await act(async () => {
      await result.current.handleBulkContentVisibility(
        'metadataPublished',
        true,
      );
    });

    expect(bulkUpdateContentVisibilityMock).toHaveBeenCalledWith(
      [
        { letterId: 'letter-1', primarySourceRevision: 4 },
        { letterId: 'letter-2', primarySourceRevision: 9 },
      ],
      'PUBLISH_METADATA',
    );
    expect(showToastMock).toHaveBeenCalledWith(
      'Published metadata for 0 letters; skipped 2 because the content changed or is no longer eligible',
      'error',
    );
    expect(showToastMock).not.toHaveBeenCalledWith(
      expect.stringContaining('for 2 letters'),
      expect.anything(),
    );
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('uses the applied count when a safe revocation reports a missing letter', async () => {
    bulkUpdateContentVisibilityMock.mockResolvedValueOnce({
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{ letterId: 'letter-2', code: 'NOT_FOUND' }],
    });
    const { result, fetchLetters } = renderBulkActions();

    await act(async () => {
      await result.current.handleBulkHide();
    });

    expect(bulkUpdateContentVisibilityMock).toHaveBeenCalledWith(
      [
        { letterId: 'letter-1', primarySourceRevision: 4 },
        { letterId: 'letter-2', primarySourceRevision: 9 },
      ],
      'HIDE_LETTER',
    );
    expect(showToastMock).toHaveBeenCalledWith(
      'Hid 1 letter; skipped 1 because it no longer exists',
      'info',
    );
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('reports unobserved selected rows without minting revisions at click time', async () => {
    bulkUpdateContentVisibilityMock.mockResolvedValueOnce({
      requested: 1,
      applied: 0,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-1',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
      }],
    });
    const { result } = renderBulkActions([
      { letterId: 'letter-1', primarySourceRevision: 4 },
    ]);

    await act(async () => {
      await result.current.handleBulkContentVisibility(
        'metadataPublished',
        true,
      );
    });

    expect(showToastMock).toHaveBeenCalledWith(
      'Published metadata for 0 letters; skipped 1 because the content changed or is no longer eligible and 1 because its source version was not loaded',
      'error',
    );
  });

  it('reports an entirely unobserved selection without sending an empty mutation', async () => {
    const { result } = renderBulkActions([]);

    await act(async () => {
      await result.current.handleBulkHide();
    });

    expect(bulkUpdateContentVisibilityMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      'Hid 0 letters; skipped 2 because their source versions were not loaded',
      'error',
    );
  });

  it('reports an unexpected per-letter failure without hiding successful mutations', async () => {
    bulkUpdateContentVisibilityMock.mockResolvedValueOnce({
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-2',
        code: 'MUTATION_FAILED',
      }],
    });
    const { result, fetchLetters } = renderBulkActions();

    await act(async () => {
      await result.current.handleBulkPublish();
    });

    expect(showToastMock).toHaveBeenCalledWith(
      'Published 1 letter; skipped 1 because its update failed',
      'info',
    );
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('refreshes authoritative rows when a bulk request fails ambiguously', async () => {
    bulkUpdateContentVisibilityMock.mockRejectedValueOnce(
      new Error('Publication response was interrupted'),
    );
    const { result, fetchLetters } = renderBulkActions();

    await act(async () => {
      await result.current.handleBulkPublish();
    });

    expect(showToastMock).toHaveBeenCalledWith(
      'Publication response was interrupted',
      'error',
    );
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('clears transcription state with the source pairs retained at selection time', async () => {
    const { result, exitEditMode, fetchLetters } = renderBulkActions();

    await act(async () => {
      await result.current.handleConfirmClearTranscriptions();
    });

    expect(bulkClearTranscriptionsMock).toHaveBeenCalledWith([
      { letterId: 'letter-1', primarySourceRevision: 4 },
      { letterId: 'letter-2', primarySourceRevision: 9 },
    ]);
    expect(showToastMock).toHaveBeenCalledWith(
      'Cleared transcriptions for 2 letters',
      'success',
    );
    expect(exitEditMode).toHaveBeenCalledOnce();
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('reports the applied clear count and retains a partially skipped selection', async () => {
    bulkClearMetadataMock.mockResolvedValueOnce({
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-2',
        code: 'SOURCE_CHANGED',
        reason: 'Letter source changed; refresh and reselect',
      }],
    });
    const { result, exitEditMode, fetchLetters } = renderBulkActions();

    await act(async () => {
      await result.current.handleConfirmClearMetadata();
    });

    expect(bulkClearMetadataMock).toHaveBeenCalledWith([
      { letterId: 'letter-1', primarySourceRevision: 4 },
      { letterId: 'letter-2', primarySourceRevision: 9 },
    ]);
    expect(showToastMock).toHaveBeenCalledWith(
      'Cleared metadata for 1 letter. Skipped: Letter source changed; refresh and reselect',
      'info',
    );
    expect(exitEditMode).not.toHaveBeenCalled();
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('reports unobserved clear selections without sending an empty mutation', async () => {
    const { result, exitEditMode, fetchLetters } = renderBulkActions([]);

    await act(async () => {
      await result.current.handleConfirmClearTranscriptions();
    });

    expect(bulkClearTranscriptionsMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      'Cleared transcriptions for 0 letters. Skipped: Source version was not loaded; refresh and reselect (2 letters)',
      'error',
    );
    expect(exitEditMode).not.toHaveBeenCalled();
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('deletes only with revisions retained from the selected rows', async () => {
    const {
      result,
      exitEditMode,
      fetchLetters,
      setSelectedIds,
    } = renderBulkActions();

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(deleteLetterMock).toHaveBeenCalledTimes(2);
    expect(deleteLetterMock).toHaveBeenNthCalledWith(1, 'letter-1', 4);
    expect(deleteLetterMock).toHaveBeenNthCalledWith(2, 'letter-2', 9);
    expect(showToastMock).toHaveBeenCalledWith('Deleted 2 letters', 'success');
    expect(exitEditMode).toHaveBeenCalledOnce();
    expect(setSelectedIds).not.toHaveBeenCalled();
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('does not delete a selected row whose source revision was never observed', async () => {
    const {
      result,
      exitEditMode,
      setSelectedIds,
    } = renderBulkActions([
      { letterId: 'letter-1', primarySourceRevision: 4 },
    ]);

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(deleteLetterMock).toHaveBeenCalledOnce();
    expect(deleteLetterMock).toHaveBeenCalledWith('letter-1', 4);
    expect(showToastMock).toHaveBeenCalledWith(
      'Deleted 1 letter. Skipped: Source version was not loaded; refresh and reselect',
      'info',
    );
    expect(exitEditMode).not.toHaveBeenCalled();
    expect(setSelectedIds).toHaveBeenCalledWith(new Set(['letter-2']));
  });

  it('reports a stale per-letter deletion without hiding successful deletions', async () => {
    deleteLetterMock.mockImplementation((
      letterId: string,
    ) => letterId === 'letter-2'
      ? Promise.reject(new ApiError(
          409,
          'Correspondence source changed',
          { code: 'SOURCE_REVISION_CHANGED' },
        ))
      : Promise.resolve());
    const {
      result,
      exitEditMode,
      fetchLetters,
      setSelectedIds,
    } = renderBulkActions();

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(showToastMock).toHaveBeenCalledWith(
      'Deleted 1 letter. Skipped: Letter source changed; refresh and reselect',
      'info',
    );
    expect(exitEditMode).not.toHaveBeenCalled();
    expect(setSelectedIds).toHaveBeenCalledWith(new Set(['letter-2']));
    expect(fetchLetters).toHaveBeenCalledOnce();
  });

  it('keeps an ambiguous deletion selected and reports its outcome truthfully', async () => {
    deleteLetterMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Connection interrupted'));
    const {
      result,
      setSelectedIds,
    } = renderBulkActions();

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(showToastMock).toHaveBeenCalledWith(
      'Deleted 1 letter. Skipped: Deletion outcome could not be confirmed; refresh before retrying',
      'info',
    );
    expect(setSelectedIds).toHaveBeenCalledWith(new Set(['letter-2']));
  });

  it('reports an entirely unobserved deletion without sending a request', async () => {
    const { result, setSelectedIds } = renderBulkActions([]);

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(deleteLetterMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      'Deleted 0 letters. Skipped: Source version was not loaded; refresh and reselect (2 letters)',
      'error',
    );
    expect(setSelectedIds).toHaveBeenCalledWith(
      new Set(['letter-1', 'letter-2']),
    );
  });
});
