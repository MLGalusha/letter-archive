import { useEffect, useState } from "react";
import {
  abortProcessing,
  getProcessingStatus,
  pauseProcessing,
  resumeProcessing,
  type ProcessingStatus,
} from "../../../api/admin";
import { useToast } from "../../../contexts/ToastContext";

interface UseDashboardProcessingControlsOptions {
  fetchLetters: () => Promise<void>;
}

export function useDashboardProcessingControls({
  fetchLetters,
}: UseDashboardProcessingControlsOptions) {
  const { showToast } = useToast();
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [wasRunning, setWasRunning] = useState(false);
  const [lastCompletedAt, setLastCompletedAt] = useState<number | null>(null);
  const [pausePending, setPausePending] = useState(false);
  const [abortPending, setAbortPending] = useState(false);

  useEffect(() => {
    if (processingStatus?.isPaused) setPausePending(false);
    if (!processingStatus?.isRunning) {
      setPausePending(false);
      setAbortPending(false);
    }
  }, [processingStatus?.isPaused, processingStatus?.isRunning]);

  const handlePauseProcessing = async () => {
    setPausePending(true);
    try {
      await pauseProcessing();
    } catch (err) {
      setPausePending(false);
      console.error("Failed to pause processing:", err);
      showToast(err instanceof Error ? err.message : "Failed to pause processing", "error");
    }
  };

  const handleResumeProcessing = async () => {
    try {
      await resumeProcessing();
      showToast("Processing resumed", "info");
    } catch (err) {
      console.error("Failed to resume processing:", err);
      showToast(err instanceof Error ? err.message : "Failed to resume processing", "error");
    }
  };

  const handleAbortProcessing = async () => {
    setAbortPending(true);
    try {
      await abortProcessing();
    } catch (err) {
      setAbortPending(false);
      console.error("Failed to abort processing:", err);
      showToast(err instanceof Error ? err.message : "Failed to abort processing", "error");
    }
  };

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await getProcessingStatus();
        setProcessingStatus(status);

        if (status.lastCompletedAt && status.lastCompletedAt !== lastCompletedAt) {
          setLastCompletedAt(status.lastCompletedAt);
          fetchLetters();
        }

        if (!status.isRunning && wasRunning) {
          fetchLetters();
        }
        setWasRunning(status.isRunning);
      } catch (err) {
        console.debug("Processing status poll failed:", err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 1000);
    return () => clearInterval(interval);
  }, [wasRunning, lastCompletedAt, fetchLetters]);

  return {
    processingStatus,
    pausePending,
    abortPending,
    handlePauseProcessing,
    handleResumeProcessing,
    handleAbortProcessing,
  };
}
