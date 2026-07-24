import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  ProcessingJobType,
  ProcessingRecentJob,
} from "../../../api/admin/processing";
import { Button } from "../../../components/common";
import { formatProcessingDate, formatTimeAgo } from "./formatters";
import { getProcessingStage, PROCESSING_STAGES } from "./stages";

interface RecentActivityListProps {
  recent: ProcessingRecentJob[];
  onRetry: (type: ProcessingJobType, letterId: string) => void;
}

type StatusFilter = "all" | ProcessingRecentJob["status"];
type StageFilter = "all" | ProcessingJobType;

export default function RecentActivityList({
  recent,
  onRetry,
}: RecentActivityListProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");

  const filtered = useMemo(
    () =>
      recent
        .filter(
          (job) =>
            (statusFilter === "all" || job.status === statusFilter) &&
            (stageFilter === "all" || job.type === stageFilter),
        )
        .slice(0, 50),
    [recent, stageFilter, statusFilter],
  );

  if (recent.length === 0) {
    return <p className="proc-queue-empty">No recent activity.</p>;
  }

  return (
    <div>
      <div className="proc-recent-filters">
        <select
          aria-label="Filter recent activity by stage"
          value={stageFilter}
          onChange={(event) =>
            setStageFilter(event.target.value as StageFilter)
          }
        >
          <option value="all">All stages</option>
          {PROCESSING_STAGES.map((stage) => (
            <option key={stage.type} value={stage.type}>
              {stage.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter recent activity by status"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as StatusFilter)
          }
        >
          <option value="all">All statuses</option>
          <option value="SUCCESS">Succeeded</option>
          <option value="FAILED">Failed</option>
          <option value="CLEARED">Cleared</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="proc-queue-empty">No activity matches these filters.</p>
      ) : (
        <ul className="proc-recent-list">
          {filtered.map((job) => {
            const stage = getProcessingStage(job.type);
            return (
              <li
                key={`${job.type}-${job.letterId}-${job.completedAt}`}
                className={`proc-recent-item proc-recent-${job.status.toLowerCase()}`}
              >
                <div className="proc-recent-main">
                  <Link to={`/admin/letters/${job.letterId}`}>
                    {formatProcessingDate(job.letterTitle)}
                  </Link>
                  <span className="proc-recent-meta">
                    {stage.label} · {job.collectionCode} ·{" "}
                    Reported {formatTimeAgo(job.completedAt)}
                  </span>
                  {job.error && (
                    <div className="proc-recent-error">{job.error}</div>
                  )}
                </div>
                <div className="proc-recent-actions">
                  <span
                    className={`proc-status-pill proc-status-${job.status.toLowerCase()}`}
                  >
                    {job.status}
                  </span>
                  {job.status === "FAILED" && (
                    <Button
                      size="sm"
                      onClick={() => onRetry(job.type, job.letterId)}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
