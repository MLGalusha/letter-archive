import type { Dispatch, SetStateAction } from "react";
import { getErrorMessage } from "../../../api/client";
import { toggleLetterFlag } from "../../../api/admin/letters";
import { useToast } from "../../../contexts/ToastContext";
import type { Letter } from "../../../types/Letter";

interface UseDashboardFlagActionsOptions {
  setLetters: Dispatch<SetStateAction<Letter[]>>;
  makeSelectionExplicit: () => void;
}

export function useDashboardFlagActions({
  setLetters,
  makeSelectionExplicit,
}: UseDashboardFlagActionsOptions) {
  const { showToast } = useToast();

  const handleToggleFlag = async (letterId: string, flagged: boolean) => {
    makeSelectionExplicit();
    setLetters(prev => prev.map(l => l.id === letterId ? {
      ...l,
      flagged,
      flaggedAt: flagged ? new Date().toISOString() : undefined,
      flaggedBy: flagged ? "admin" : undefined,
    } : l));

    try {
      await toggleLetterFlag(letterId, flagged);
    } catch (err) {
      setLetters(prev => prev.map(l => l.id === letterId ? {
        ...l,
        flagged: !flagged,
        flaggedAt: !flagged ? new Date().toISOString() : undefined,
        flaggedBy: !flagged ? "admin" : undefined,
      } : l));
      showToast(
        getErrorMessage(err, `Failed to ${flagged ? "flag" : "unflag"} letter`),
        "error",
      );
    }
  };

  return {
    handleToggleFlag,
  };
}
