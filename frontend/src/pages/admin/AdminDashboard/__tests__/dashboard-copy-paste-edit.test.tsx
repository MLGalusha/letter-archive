import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../../contexts/ToastContext";
import { useDashboardCopyPasteEdit } from "../useDashboardCopyPasteEdit";

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function makeMouseEvent({ shiftKey = false }: { shiftKey?: boolean } = {}) {
  return {
    shiftKey,
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent;
}

describe("useDashboardCopyPasteEdit", () => {
  it("uses row selection instead of navigation when selection mode is active", () => {
    const handleCheckboxChange = vi.fn();
    const { result } = renderHook(
      () => useDashboardCopyPasteEdit({
        selectedIds: new Set(["letter-1"]),
        clearSelection: vi.fn(),
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
});
