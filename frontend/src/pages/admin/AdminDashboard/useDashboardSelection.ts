import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import type { BulkSource } from '../../../api/admin';
import type { DashboardCommittedQuery } from './dashboardQueryModel';

interface IdentifiableRow {
  id: string;
  primarySourceRevision?: number;
}

type DashboardSelectionScope =
  | { readonly kind: 'explicit' }
  | {
      readonly kind: 'all-filtered';
      readonly queryOwner: {
        readonly query: DashboardCommittedQuery;
      };
    };

interface DashboardSelectionState {
  ids: Set<string>;
  sourceRevisions: Map<string, number>;
  scope: DashboardSelectionScope;
  intent: DashboardSelectionIntent;
}

const EXPLICIT_SCOPE: DashboardSelectionScope = { kind: 'explicit' };

export interface DashboardSelectionIntent {
  readonly id: symbol;
}

export type ReplaceDashboardSelection = (
  action: SetStateAction<Set<string>>,
  expectedIntent?: DashboardSelectionIntent,
) => void;

function createSelectionIntent(): DashboardSelectionIntent {
  return { id: Symbol('dashboard-selection-intent') };
}

function retainSelectedSources(
  ids: Set<string>,
  previousSourceRevisions: Map<string, number>,
  rows: readonly IdentifiableRow[],
): Map<string, number> {
  const sourceRevisions = new Map<string, number>();

  for (const letterId of ids) {
    const previousRevision = previousSourceRevisions.get(letterId);
    if (previousRevision !== undefined) {
      sourceRevisions.set(letterId, previousRevision);
      continue;
    }

    const row = rows.find((candidate) => candidate.id === letterId);
    if (typeof row?.primarySourceRevision === 'number') {
      sourceRevisions.set(letterId, row.primarySourceRevision);
    }
  }

  return sourceRevisions;
}

function createExplicitSelection(
  previous: DashboardSelectionState,
  selectedIds: Set<string>,
  rows: readonly IdentifiableRow[],
  intent: DashboardSelectionIntent,
): DashboardSelectionState {
  const ids = new Set(selectedIds);
  return {
    ids,
    sourceRevisions: retainSelectedSources(
      ids,
      previous.sourceRevisions,
      rows,
    ),
    scope: EXPLICIT_SCOPE,
    intent,
  };
}

/**
 * Owns Dashboard selection IDs, their observed source revisions, and the provenance
 * for an exact all-filtered selection as one state transition boundary.
 *
 * The query is optional only for the collections table, which reuses explicit row
 * selection but has no all-filtered action.
 */
export function useDashboardSelection<T extends IdentifiableRow>(
  rows: T[],
  query?: DashboardCommittedQuery,
) {
  const [selection, setSelection] = useState<DashboardSelectionState>(() => ({
    ids: new Set(),
    sourceRevisions: new Map(),
    scope: EXPLICIT_SCOPE,
    intent: createSelectionIntent(),
  }));
  const currentIntentRef = useRef(selection.intent);
  const queryOwner = useMemo(
    () => query ? { query } : null,
    [query],
  );

  const replaceExplicitSelection = useCallback<ReplaceDashboardSelection>((
    action,
    expectedIntent,
  ) => {
    if (
      expectedIntent
      && currentIntentRef.current !== expectedIntent
    ) {
      return;
    }
    const intent = createSelectionIntent();
    currentIntentRef.current = intent;
    setSelection((previous) => {
      const ids = typeof action === 'function'
        ? action(previous.ids)
        : action;
      return createExplicitSelection(previous, ids, rows, intent);
    });
  }, [rows]);

  const reconcileSelection = useCallback((sources: readonly BulkSource[]) => {
    setSelection((previous) => {
      const validSources = new Map(
        sources.map(({ letterId, primarySourceRevision }) => (
          [letterId, primarySourceRevision] as const
        )),
      );
      const ids = new Set(
        [...previous.ids].filter((letterId) => validSources.has(letterId)),
      );
      const sourceRevisions = new Map(
        [...ids].map((letterId) => (
          [letterId, validSources.get(letterId)!] as const
        )),
      );

      return {
        ids,
        sourceRevisions,
        scope: EXPLICIT_SCOPE,
        intent: previous.intent,
      };
    });
  }, []);

  const makeSelectionExplicit = useCallback(() => {
    const intent = createSelectionIntent();
    currentIntentRef.current = intent;
    setSelection((previous) => ({
      ...previous,
      scope: EXPLICIT_SCOPE,
      intent,
    }));
    return intent;
  }, []);

  const toggleSelection = useCallback((id: string) => {
    const intent = createSelectionIntent();
    currentIntentRef.current = intent;
    setSelection((previous) => {
      const ids = new Set(previous.ids);
      const selecting = !ids.has(id);
      if (selecting) ids.add(id);
      else ids.delete(id);

      return createExplicitSelection(previous, ids, rows, intent);
    });
  }, [rows]);

  const clearSelection = useCallback(() => {
    const intent = createSelectionIntent();
    currentIntentRef.current = intent;
    setSelection({
      ids: new Set(),
      sourceRevisions: new Map(),
      scope: EXPLICIT_SCOPE,
      intent,
    });
  }, []);

  const clearSelectionIfCurrent = useCallback((
    expectedIntent: DashboardSelectionIntent,
  ) => {
    if (currentIntentRef.current !== expectedIntent) return;

    const intent = createSelectionIntent();
    currentIntentRef.current = intent;
    setSelection({
      ids: new Set(),
      sourceRevisions: new Map(),
      scope: EXPLICIT_SCOPE,
      intent,
    });
  }, []);

  const isSelectionIntentCurrent = useCallback((
    expectedIntent: DashboardSelectionIntent,
  ) => currentIntentRef.current === expectedIntent, []);

  const allPageSelected = useMemo(
    () => rows.length > 0 && rows.every((row) => selection.ids.has(row.id)),
    [rows, selection.ids],
  );

  const handleSelectAllPage = useCallback(() => {
    if (allPageSelected) {
      clearSelection();
      return;
    }

    const intent = createSelectionIntent();
    currentIntentRef.current = intent;
    setSelection((previous) => {
      const ids = new Set(previous.ids);
      for (const row of rows) ids.add(row.id);

      return createExplicitSelection(previous, ids, rows, intent);
    });
  }, [allPageSelected, clearSelection, rows]);

  const selectAllFiltered = useCallback((
    sources: readonly BulkSource[],
    expectedIntent: DashboardSelectionIntent,
  ) => {
    if (
      !queryOwner
      || currentIntentRef.current !== expectedIntent
    ) {
      return;
    }

    const intent = createSelectionIntent();
    currentIntentRef.current = intent;
    setSelection({
      ids: new Set(sources.map(({ letterId }) => letterId)),
      sourceRevisions: new Map(sources.map(({
        letterId,
        primarySourceRevision,
      }) => [letterId, primarySourceRevision])),
      scope: {
        kind: 'all-filtered',
        queryOwner,
      },
      intent,
    });
  }, [queryOwner]);

  const selectedSources = useMemo(() => Array.from(selection.ids).flatMap(
    (letterId) => {
      const primarySourceRevision = selection.sourceRevisions.get(letterId);
      return primarySourceRevision === undefined
        ? []
        : [{ letterId, primarySourceRevision }];
    },
  ), [selection.ids, selection.sourceRevisions]);

  return {
    selectedIds: selection.ids,
    selectedSources,
    selectionIntent: selection.intent,
    replaceExplicitSelection,
    reconcileSelection,
    makeSelectionExplicit,
    isSelectionIntentCurrent,
    allFilteredSelected: selection.scope.kind === 'all-filtered'
      && selection.scope.queryOwner === queryOwner,
    toggleSelection,
    clearSelection,
    clearSelectionIfCurrent,
    allPageSelected,
    handleSelectAllPage,
    selectAllFiltered,
  };
}
