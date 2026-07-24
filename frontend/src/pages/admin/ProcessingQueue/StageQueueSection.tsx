import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  ProcessingActiveJob,
  ProcessingJobType,
  ProcessingQueueItem,
} from "../../../api/admin/processing";
import { Button } from "../../../components/common";
import { formatCorrespondents, formatProcessingDate } from "./formatters";
import type { ProcessingStageDescriptor } from "./stages";

interface StageQueueSectionProps {
  stage: ProcessingStageDescriptor;
  queued: ProcessingQueueItem[];
  active: ProcessingActiveJob[];
  onRemove: (type: ProcessingJobType, item: ProcessingQueueItem) => void;
  onClear: (
    type: ProcessingJobType,
    label: string,
    items: ProcessingQueueItem[],
  ) => void;
  onCancel: (type: ProcessingJobType, job: ProcessingActiveJob) => void;
}

function letterMeta(
  collectionCode: string,
  sender: string | null,
  recipient: string | null,
): string {
  const correspondents = formatCorrespondents(sender, recipient);
  return correspondents
    ? `${collectionCode} · ${correspondents}`
    : collectionCode;
}

export default function StageQueueSection({
  stage,
  queued,
  active,
  onRemove,
  onClear,
  onCancel,
}: StageQueueSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const queuePanelId = `proc-queue-${stage.type}`;

  return (
    <div className="proc-queue-section">
      <div className="proc-queue-head">
        <button
          type="button"
          className="proc-queue-toggle"
          aria-expanded={expanded}
          aria-controls={queuePanelId}
          onClick={() => setExpanded((current) => !current)}
        >
          <svg
            className={`proc-queue-caret ${expanded ? "is-open" : ""}`}
            viewBox="0 0 20 20"
            width="18"
            height="18"
            aria-hidden="true"
          >
            <path
              d="M6 8l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="proc-queue-label">{stage.label} queue</span>
          <span className="proc-queue-count">{queued.length} shown</span>
        </button>
        {queued.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onClear(stage.type, stage.label, queued)}
          >
            Clear queue
          </Button>
        )}
      </div>

      {active.length > 0 && (
        <div className="proc-active-list" aria-label={`${stage.label} active jobs`}>
          {active.map((job) => (
            <div className="proc-active-row" key={`${stage.type}-${job.letterId}`}>
              <div>
                <strong>Active:</strong>{" "}
                <Link to={`/admin/letters/${job.letterId}`}>
                  {formatProcessingDate(job.letterTitle)}
                </Link>{" "}
                ({letterMeta(job.collectionCode, job.sender, job.recipient)})
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() => onCancel(stage.type, job)}
              >
                Cancel
              </Button>
            </div>
          ))}
        </div>
      )}

      <div id={queuePanelId}>
        {expanded && queued.length > 0 && (
          <ul className="proc-queue-list">
            {queued.map((item) => (
              <li className="proc-queue-item" key={item.letterId}>
                <Link
                  to={`/admin/letters/${item.letterId}`}
                  className="proc-queue-item-main"
                >
                  <span className="proc-queue-item-title">
                    {formatProcessingDate(item.letterTitle)}
                  </span>
                  <span className="proc-queue-item-meta">
                    {letterMeta(
                      item.collectionCode,
                      item.sender,
                      item.recipient,
                    )}
                  </span>
                </Link>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onRemove(stage.type, item)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        {expanded && queued.length === 0 && (
          <p className="proc-queue-empty">Queue is empty.</p>
        )}
      </div>
    </div>
  );
}
