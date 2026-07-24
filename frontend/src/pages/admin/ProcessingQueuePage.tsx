import { useCallback } from "react";
import { getErrorMessage } from "../../api/client";
import {
  cancelProcessingJob,
  clearProcessingQueue,
  removeProcessingQueueItem,
  retryProcessingJob,
  wakeProcessingWorker,
  type ProcessingActiveJob,
  type ProcessingJobType,
  type ProcessingQueueClearResult,
  type ProcessingQueueItem,
  type ProcessingRecentJob,
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

function clearResultMessage(result: ProcessingQueueClearResult): string {
  if (result.skipped === 0) {
    return `Cleared ${result.cleared} displayed queue item${result.cleared === 1 ? "" : "s"}`;
  }

  const sourceChanged = result.skipReasons.filter(
    ({ code }) => code === "SOURCE_REVISION_CHANGED",
  ).length;
  const jobChanged = result.skipReasons.filter(
    ({ code }) => code === "PROCESSING_JOB_CHANGED",
  ).length;
  const missing = result.skipReasons.filter(
    ({ code }) => code === "NOT_FOUND",
  ).length;
  const reasons = [
    sourceChanged > 0 ? `${sourceChanged} source changed` : null,
    jobChanged > 0 ? `${jobChanged} job changed` : null,
    missing > 0 ? `${missing} no longer exists` : null,
  ].filter((reason): reason is string => reason !== null);

  return `Cleared ${result.cleared} of ${result.requested} displayed items; skipped ${reasons.join(", ")}`;
}

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
    async (type: ProcessingJobType, item: ProcessingQueueItem) => {
      try {
        await removeProcessingQueueItem(type, item);
      } catch (err) {
        showToast(
          getErrorMessage(err, "Failed to remove from queue"),
          "error",
        );
      } finally {
        await refresh();
      }
    },
    [refresh, showToast],
  );

  const handleClear = useCallback(
    async (
      type: ProcessingJobType,
      label: string,
      items: ProcessingQueueItem[],
    ) => {
      if (!window.confirm(
        `Clear the ${items.length} displayed ${label} queue item${items.length === 1 ? "" : "s"}? Newly queued work will not be affected.`,
      )) return;
      try {
        const result = await clearProcessingQueue(type, items);
        showToast(
          clearResultMessage(result),
          result.cleared > 0 ? "info" : "error",
        );
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to clear queue"), "error");
      } finally {
        await refresh();
      }
    },
    [refresh, showToast],
  );

  const handleRetry = useCallback(
    async (job: ProcessingRecentJob) => {
      try {
        await retryProcessingJob(job.type, job);
        showToast("Retry queued", "info");
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to retry"), "error");
      } finally {
        await refresh();
      }
    },
    [refresh, showToast],
  );

  const handleCancel = useCallback(
    async (type: ProcessingJobType, job: ProcessingActiveJob) => {
      if (!window.confirm("Cancel this running job?")) return;
      try {
        await cancelProcessingJob(type, job);
        showToast("Job cancelled", "info");
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to cancel"), "error");
      } finally {
        await refresh();
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
                  onRemove={(type, item) =>
                    void handleRemove(type, item)
                  }
                  onClear={(type, label, items) =>
                    void handleClear(type, label, items)
                  }
                  onCancel={(type, job) =>
                    void handleCancel(type, job)
                  }
                />
              ))}
            </section>

            <section className="proc-recent">
              <h2 className="proc-section-title">Recent activity</h2>
              <RecentActivityList
                recent={status.recent}
                onRetry={(job) => void handleRetry(job)}
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
