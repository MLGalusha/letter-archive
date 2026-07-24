import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BulkUpdateResponse } from "../../../../api/admin";
import { ToastProvider } from "../../../../contexts/ToastContext";
import { useDashboardCopyPasteEdit } from "../useDashboardCopyPasteEdit";

const bulkUpdateFieldsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../api/admin", () => ({
  bulkUpdateFields: bulkUpdateFieldsMock,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function makeMouseEvent({ shiftKey = false }: { shiftKey?: boolean } = {}) {
  return {
    shiftKey,
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("useDashboardCopyPasteEdit", () => {
  it("uses row selection instead of navigation when selection mode is active", () => {
    const handleCheckboxChange = vi.fn();
    const { result } = renderHook(
      () => useDashboardCopyPasteEdit({
        selectedIds: new Set(["letter-1"]),
        clearSelection: vi.fn(),
        makeSelectionExplicit: vi.fn(),
        isSelectionIntentCurrent: vi.fn().mockReturnValue(true),
        handleCheckboxChange,
        fetchLetters: vi.fn(),
      }),
      { wrapper },
    );

    const handled = result.current.handleEditModeRowClick(
      "letter-2",
      1,
      makeMouseEvent({ shiftKey: true }),
    );

    expect(handled).toBe(true);
    expect(handleCheckboxChange).toHaveBeenCalledWith("letter-2", 1, { shiftKey: true });
  });

  it("lets copy mode own row clicks without changing selection", () => {
    const handleCheckboxChange = vi.fn();
    const { result } = renderHook(
      () => useDashboardCopyPasteEdit({
        selectedIds: new Set(["letter-1"]),
        clearSelection: vi.fn(),
        makeSelectionExplicit: vi.fn(),
        isSelectionIntentCurrent: vi.fn().mockReturnValue(true),
        handleCheckboxChange,
        fetchLetters: vi.fn(),
      }),
      { wrapper },
    );

    act(() => {
      result.current.toggleCopyMode();
    });

    const handled = result.current.handleEditModeRowClick(
      "letter-2",
      1,
      makeMouseEvent({ shiftKey: true }),
    );

    expect(handled).toBe(true);
    expect(handleCheckboxChange).not.toHaveBeenCalled();
  });

  it("retains observed revisions and only keeps skipped edits dirty after a mixed save", async () => {
    const fetchLetters = vi.fn().mockResolvedValue(undefined);
    const makeSelectionExplicit = vi.fn();
    bulkUpdateFieldsMock.mockResolvedValueOnce({
      requested: 2,
      applied: 1,
      skipped: 1,
      updated: 1,
      skipReasons: [{ letterId: "letter-stale", code: "SOURCE_CHANGED" }],
    });
    const { result } = renderHook(
      () => useDashboardCopyPasteEdit({
        selectedIds: new Set(["letter-current", "letter-stale"]),
        clearSelection: vi.fn(),
        makeSelectionExplicit,
        isSelectionIntentCurrent: vi.fn().mockReturnValue(true),
        handleCheckboxChange: vi.fn(),
        fetchLetters,
      }),
      { wrapper },
    );

    act(() => {
      result.current.toggleCopyMode();
    });
    act(() => {
      result.current.handleCellClick(
        "letter-source",
        2,
        "sender",
        "Mabel",
        makeMouseEvent(),
      );
    });
    act(() => {
      result.current.handleCellClick(
        "letter-current",
        4,
        "sender",
        "Old current",
        makeMouseEvent(),
      );
      result.current.handleCellClick(
        "letter-stale",
        9,
        "sender",
        "Old stale",
        makeMouseEvent(),
      );
    });

    await act(async () => {
      await result.current.handleDone();
    });

    expect(bulkUpdateFieldsMock).toHaveBeenCalledWith([
      {
        letterId: "letter-current",
        primarySourceRevision: 4,
        sender: "Mabel",
      },
      {
        letterId: "letter-stale",
        primarySourceRevision: 9,
        sender: "Mabel",
      },
    ]);
    expect(Array.from(result.current.pendingChanges)).toEqual([
      [
        "letter-stale",
        { primarySourceRevision: 9, sender: "Mabel" },
      ],
    ]);
    expect(fetchLetters).toHaveBeenCalledOnce();
    expect(makeSelectionExplicit).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      outcome: {
        requested: 1,
        applied: 1,
        skipped: 0,
        updated: 1,
        skipReasons: [],
      } satisfies BulkUpdateResponse,
      resultKind: "successful",
    },
    {
      outcome: {
        requested: 2,
        applied: 1,
        skipped: 1,
        updated: 1,
        skipReasons: [{
          letterId: "letter-old",
          code: "SOURCE_CHANGED",
        }],
      } satisfies BulkUpdateResponse,
      resultKind: "partially successful",
    },
  ])("does not erase edits staged after an older $resultKind save", async ({
    outcome,
  }) => {
    const saveRequest = createDeferred<BulkUpdateResponse>();
    bulkUpdateFieldsMock.mockReturnValueOnce(saveRequest.promise);
    let currentIntent = { id: Symbol("initial-intent") };
    const makeSelectionExplicit = vi.fn(() => {
      currentIntent = { id: Symbol("selection-intent") };
      return currentIntent;
    });
    const clearSelection = vi.fn();
    const { result } = renderHook(
      () => useDashboardCopyPasteEdit({
        selectedIds: new Set(["letter-old", "letter-new"]),
        clearSelection,
        makeSelectionExplicit,
        isSelectionIntentCurrent: (intent) => intent === currentIntent,
        handleCheckboxChange: vi.fn(),
        fetchLetters: vi.fn().mockResolvedValue(undefined),
      }),
      { wrapper },
    );

    act(() => {
      result.current.toggleCopyMode();
    });
    act(() => {
      result.current.handleCellClick(
        "letter-source",
        1,
        "sender",
        "Mabel",
        makeMouseEvent(),
      );
    });
    act(() => {
      result.current.handleCellClick(
        "letter-old",
        2,
        "sender",
        "Old sender",
        makeMouseEvent(),
      );
    });

    let saveAction!: Promise<void>;
    act(() => {
      saveAction = result.current.handleDone();
    });
    act(() => {
      result.current.handleCellClick(
        "letter-new",
        3,
        "sender",
        "New sender",
        makeMouseEvent(),
      );
    });
    await act(async () => {
      saveRequest.resolve(outcome);
      await saveAction;
    });

    expect(clearSelection).not.toHaveBeenCalled();
    expect(Array.from(result.current.pendingChanges)).toEqual([
      [
        "letter-old",
        { primarySourceRevision: 2, sender: "Mabel" },
      ],
      [
        "letter-new",
        { primarySourceRevision: 3, sender: "Mabel" },
      ],
    ]);
  });
});
