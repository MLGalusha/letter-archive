import { useEffect } from "react";
import type { PersistedState } from "./types";
import { savePersistedState } from "./utils";

export function useDashboardPersistedState(state: PersistedState) {
  useEffect(() => {
    savePersistedState(state);
  }, [state]);
}
