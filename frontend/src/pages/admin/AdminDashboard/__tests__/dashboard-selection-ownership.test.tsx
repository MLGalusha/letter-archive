import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SOURCE_REVISION_CHANGED_ERROR_CODE,
} from '../../../../api/client';
import type { DashboardCommittedQuery } from '../dashboardQueryModel';
import { useDashboardBulkActions } from '../useDashboardBulkActions';
import { useDashboardSelection } from '../useDashboardSelection';

const {
  bulkClearMetadataMock,
  bulkClearTranscriptionsMock,
  bulkUpdateContentVisibilityMock,
  deleteLetterMock,
  exitEditModeMock,
  fetchLettersMock,
  showToastMock,
} = vi.hoisted(() => ({
  bulkClearMetadataMock: vi.fn(),
  bulkClearTranscriptionsMock: vi.fn(),
  bulkUpdateContentVisibilityMock: vi.fn(),
  deleteLetterMock: vi.fn(),
  exitEditModeMock: vi.fn(),
  fetchLettersMock: vi.fn(),
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

const pageRows = [{
  id: 'letter-on-page',
  primarySourceRevision: 7,
}];

const query: DashboardCommittedQuery = {
  collectionFilter: 'all',
  visibilityFilter: 'ALL',
  searchQuery: '',
  yearFilter: null,
  monthFilter: null,
  dayFilter: null,
  dateFromFilter: null,
  dateToFilter: null,
  transcriptStatusFilters: [],
  metadataStatusFilters: [],
  extraContentStatusFilters: [],
  workflowFilters: [],
  flaggedFilter: 'ALL',
  missingFilters: [],
  contentShapeFilters: [],
  sortColumns: [{ field: 'lastOpenedAt', direction: 'desc' }],
};

function usePartialDeleteHarness() {
  const selection = useDashboardSelection(pageRows, query);
  const bulkActions = useDashboardBulkActions({
    selectedIds: selection.selectedIds,
    selectedSources: selection.selectedSources,
    replaceExplicitSelection: selection.replaceExplicitSelection,
    makeSelectionExplicit: selection.makeSelectionExplicit,
    exitEditMode: exitEditModeMock,
    fetchLetters: fetchLettersMock,
  });

  return { ...selection, ...bulkActions };
}

const provenanceFiles = {
  selection: 'pages/admin/AdminDashboard/useDashboardSelection.ts',
  rowSelection: 'pages/admin/AdminDashboard/useDashboardRowSelection.ts',
  filteredSelection: 'pages/admin/AdminDashboard/useDashboardFilteredSelection.ts',
  bulkActions: 'pages/admin/AdminDashboard/useDashboardBulkActions.ts',
  route: 'pages/admin/AdminDashboard.tsx',
} as const;

const mutationOwnerFiles = {
  bulkActions: 'pages/admin/AdminDashboard/useDashboardBulkActions.ts',
  processingActions: 'pages/admin/AdminDashboard/useDashboardProcessingActions.ts',
  copyPasteEdit: 'pages/admin/AdminDashboard/useDashboardCopyPasteEdit.ts',
  flagActions: 'pages/admin/AdminDashboard/useDashboardFlagActions.ts',
} as const;

async function readSource(relativePath: string) {
  return readFile(path.resolve(process.cwd(), 'src', relativePath), 'utf8');
}

describe('dashboard selection provenance ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteLetterMock.mockResolvedValue(undefined);
    fetchLettersMock.mockResolvedValue(undefined);
  });

  it('makes a skipped subset explicit after partially deleting an all-filtered selection', async () => {
    const { result } = renderHook(usePartialDeleteHarness);

    act(() => {
      result.current.selectAllFiltered([
        { letterId: 'letter-on-page', primarySourceRevision: 7 },
        { letterId: 'letter-off-page', primarySourceRevision: 8 },
      ], result.current.selectionIntent);
    });

    expect(result.current.allFilteredSelected).toBe(true);
    expect(result.current.selectedSources).toEqual([
      { letterId: 'letter-on-page', primarySourceRevision: 7 },
      { letterId: 'letter-off-page', primarySourceRevision: 8 },
    ]);

    deleteLetterMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError(
        409,
        'Source changed',
        { code: SOURCE_REVISION_CHANGED_ERROR_CODE },
      ));

    await act(async () => {
      await result.current.handleConfirmDelete();
    });

    expect(deleteLetterMock).toHaveBeenCalledWith('letter-on-page', 7);
    expect(deleteLetterMock).toHaveBeenCalledWith('letter-off-page', 8);
    expect(Array.from(result.current.selectedIds)).toEqual([
      'letter-off-page',
    ]);
    expect(result.current.allFilteredSelected).toBe(false);
    expect(exitEditModeMock).not.toHaveBeenCalled();
    expect(fetchLettersMock).toHaveBeenCalledOnce();
    expect(showToastMock).toHaveBeenCalledWith(
      'Deleted 1 letter. Skipped: Letter source changed; refresh and reselect',
      'info',
    );
  });

  it('revokes all-filtered provenance before a mutation that retains selection', async () => {
    const { result } = renderHook(usePartialDeleteHarness);
    bulkUpdateContentVisibilityMock.mockResolvedValueOnce({
      requested: 2,
      applied: 1,
      skipped: 1,
      skipReasons: [{
        letterId: 'letter-off-page',
        code: 'SOURCE_CHANGED_OR_INELIGIBLE',
      }],
    });

    act(() => {
      result.current.selectAllFiltered([
        { letterId: 'letter-on-page', primarySourceRevision: 7 },
        { letterId: 'letter-off-page', primarySourceRevision: 8 },
      ], result.current.selectionIntent);
    });
    expect(result.current.allFilteredSelected).toBe(true);

    await act(async () => {
      await result.current.handleBulkPublish();
    });

    expect(result.current.allFilteredSelected).toBe(false);
    expect(result.current.selectedSources).toEqual([
      { letterId: 'letter-on-page', primarySourceRevision: 7 },
      { letterId: 'letter-off-page', primarySourceRevision: 8 },
    ]);
    expect(bulkUpdateContentVisibilityMock).toHaveBeenCalledWith(
      result.current.selectedSources,
      'PUBLISH_LETTER',
    );
  });

  it('stores all-filtered provenance in the atomic selection state', async () => {
    const source = await readSource(provenanceFiles.selection);

    expect(source).not.toMatch(
      /\[\s*allFilteredSelected\s*,\s*setAllFilteredSelected\s*\]\s*=\s*useState\(\s*false\s*\)/,
    );
  });

  it('does not plumb an independent all-filtered setter through dashboard hooks or the route', async () => {
    const entries = await Promise.all(
      Object.entries(provenanceFiles).map(async ([owner, relativePath]) => [
        owner,
        await readSource(relativePath),
      ] as const),
    );
    const offenders = entries
      .filter(([, source]) => source.includes('setAllFilteredSelected'))
      .map(([owner]) => owner);

    expect(offenders).toEqual([]);
  });

  it('routes selection-retaining mutations through the explicit-scope transition', async () => {
    const entries = await Promise.all(
      Object.entries(mutationOwnerFiles).map(async ([owner, relativePath]) => [
        owner,
        await readSource(relativePath),
      ] as const),
    );
    const missingOwners = entries
      .filter(([, source]) => !source.includes('makeSelectionExplicit()'))
      .map(([owner]) => owner);

    expect(missingOwners).toEqual([]);
  });
});
