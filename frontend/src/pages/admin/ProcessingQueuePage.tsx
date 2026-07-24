import { useCallback } from "react";
import { getErrorMessage } from "../../api/client";
import {
  cancelProcessingJob,
  clearProcessingQueue,
  removeProcessingQueueItem,
  retryProcessingJob,
  wakeProcessingWorker,
  type ProcessingJobType,
} from "../../api/admin/processing";
import AdminLayout from "../../components/AdminLayout/AdminLayout";
import { Button } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import { useProcessingState } from "../../hooks/useProcessingState";
import RecentActivityList from "./ProcessingQueue/RecentActivityList";
import StageQueueSection from "./ProcessingQueue/StageQueueSection";
import StageSummaryCard from "./ProcessingQueue/StageSummaryCard";
import WorkerStatusCard from "./ProcessingQueue/WorkerStatusCard";
import { formatTimeAgo } from "./ProcessingQueue/formatters";
import {
  getStageActiveJobs,
  getStageQueue,
  PROCESSING_STAGES,
} from "./ProcessingQueue/stages";
import "./ProcessingQueuePage.css";

export default function ProcessingQueuePage() {
  const { showToast } = useToast();
  const { status, loading, error, lastUpdatedAt, refresh } =
    useProcessingState();

  const handleWake = useCallback(async () => {
    try {
      const result = await wakeProcessingWorker();
      if (result.requested) {
        showToast("Global worker requested for queued processing", "success");
      } else if (result.reason === "queue_empty") {
        showToast("No durable processing work is queued", "info");
      } else {
        showToast(
          "Managed worker is not configured here; run the separate worker process in local development",
          "info",
        );
      }
      await refresh();
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to wake worker"), "error");
    }
  }, [refresh, showToast]);

  const handleRemove = useCallback(
    async (type: ProcessingJobType, letterId: string) => {
      try {
        await removeProcessingQueueItem(type, letterId);
        await refresh();
      } catch (err) {
        showToast(
          getErrorMessage(err, "Failed to remove from queue"),
          "error",
        );
      }
    },
    [refresh, showToast],
  );

  const handleClear = useCallback(
    async (type: ProcessingJobType, label: string) => {
      if (!window.confirm(`Clear the entire ${label} queue?`)) return;
      try {
        const result = await clearProcessingQueue(type);
        showToast(`Cleared ${result.cleared} items`, "info");
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to clear queue"), "error");
      }
    },
    [refresh, showToast],
  );

  const handleRetry = useCallback(
    async (type: ProcessingJobType, letterId: string) => {
      try {
        await retryProcessingJob(type, letterId);
        showToast("Retry queued", "info");
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to retry"), "error");
      }
    },
    [refresh, showToast],
  );

  const handleCancel = useCallback(
    async (type: ProcessingJobType, letterId: string) => {
      if (!window.confirm("Cancel this running job?")) return;
      try {
        await cancelProcessingJob(type, letterId);
        showToast("Job cancelled", "info");
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to cancel"), "error");
      }
    },
    [refresh, showToast],
  );

  return (
    <AdminLayout>
      <div className="proc-page">
        <header className="proc-header">
          <div>
            <p className="proc-kicker">Admin</p>
            <h1 className="proc-title">Processing</h1>
            <p className="proc-subtitle">
              Monitor and manage the durable processing queue.
            </p>
          </div>
          <div className="proc-header-meta">
            <div className="proc-header-actions">
              <Button
                size="sm"
                variant="secondary"
                loading={loading && status !== null}
                onClick={() => void refresh()}
              >
                Refresh
              </Button>
              <Button size="sm" onClick={() => void handleWake()}>
                Wake worker
              </Button>
            </div>
            <span className="proc-updated">
              {lastUpdatedAt
                ? `Last refreshed ${formatTimeAgo(
                    new Date(lastUpdatedAt).toISOString(),
                  )}`
                : "Waiting for first durable snapshot"}
            </span>
          </div>
        </header>

        {loading && !status && <p className="proc-loading">Loading…</p>}
        {error && <p className="proc-error">{error}</p>}

        {status && (
          <>
            <section className="proc-cards-row" aria-label="Processing stages">
              {PROCESSING_STAGES.map((stage) => (
                <StageSummaryCard
                  key={stage.type}
                  stage={stage}
                  queued={getStageQueue(status, stage)}
                  active={getStageActiveJobs(status, stage.type)}
                />
              ))}
            </section>

            <section className="proc-queues" aria-label="Durable queues">
              {PROCESSING_STAGES.map((stage) => (
                <StageQueueSection
                  key={stage.type}
                  stage={stage}
                  queued={getStageQueue(status, stage)}
                  active={getStageActiveJobs(status, stage.type)}
                  onRemove={(type, letterId) =>
                    void handleRemove(type, letterId)
                  }
                  onClear={(type, label) => void handleClear(type, label)}
                  onCancel={(type, letterId) =>
                    void handleCancel(type, letterId)
                  }
                />
              ))}
            </section>

            <section className="proc-recent">
              <h2 className="proc-section-title">Recent activity</h2>
              <RecentActivityList
                recent={status.recent}
                onRetry={(type, letterId) => void handleRetry(type, letterId)}
              />
            </section>

            <section className="proc-observation">
              <WorkerStatusCard state={status.worker} />
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
