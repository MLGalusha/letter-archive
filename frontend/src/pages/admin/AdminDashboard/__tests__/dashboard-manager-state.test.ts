import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDashboardManagerState } from "../useDashboardManagerState";

describe("useDashboardManagerState", () => {
  it("replaces the active manager when another manager opens", () => {
    const { result } = renderHook(() => useDashboardManagerState());

    act(() => {
      result.current.setManagerOpen("filters", true);
      result.current.setManagerOpen("savedViews", true);
    });

    expect(result.current.activeManager).toBe("savedViews");
  });

  it("toggles only the requested manager", () => {
    const { result } = renderHook(() => useDashboardManagerState());

    act(() => {
      result.current.toggleManager("sort");
    });
    expect(result.current.activeManager).toBe("sort");

    act(() => {
      result.current.toggleManager("sort");
    });
    expect(result.current.activeManager).toBeNull();

    act(() => {
      result.current.toggleManager("columns");
    });
    expect(result.current.activeManager).toBe("columns");
  });

  it("ignores a stale close for a manager that is no longer active", () => {
    const { result } = renderHook(() => useDashboardManagerState());

    act(() => {
      result.current.setManagerOpen("savedViews", true);
      result.current.setManagerOpen("sort", true);
      result.current.closeManager("savedViews");
      result.current.setManagerOpen("savedViews", false);
    });

    expect(result.current.activeManager).toBe("sort");
  });

  it("closes the active manager explicitly or all managers unconditionally", () => {
    const { result } = renderHook(() => useDashboardManagerState());

    act(() => {
      result.current.setManagerOpen("columns", true);
      result.current.closeManager("columns");
    });
    expect(result.current.activeManager).toBeNull();

    act(() => {
      result.current.setManagerOpen("filters", true);
      result.current.closeAllManagers();
    });
    expect(result.current.activeManager).toBeNull();
  });
});
