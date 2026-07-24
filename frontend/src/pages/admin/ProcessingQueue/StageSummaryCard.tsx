import type {
  ProcessingActiveJob,
  ProcessingQueueItem,
} from "../../../api/admin/processing";
import type { ProcessingStageDescriptor } from "./stages";

interface StageSummaryCardProps {
  stage: ProcessingStageDescriptor;
  queued: ProcessingQueueItem[];
  active: ProcessingActiveJob[];
}

export default function StageSummaryCard({
  stage,
  queued,
  active,
}: StageSummaryCardProps) {
  return (
    <div className="proc-card" data-key={stage.type}>
      <div className="proc-card-head">
        <h3 className="proc-card-title">{stage.label}</h3>
        <p className="proc-card-desc">{stage.description}</p>
      </div>
      <div className="proc-card-stats">
        <div>
          <span className="proc-stat-label">Queued shown</span>
          <span className="proc-stat-value">{queued.length}</span>
        </div>
        <div>
          <span className="proc-stat-label">Active</span>
          <span className="proc-stat-value">{active.length}</span>
        </div>
      </div>
    </div>
  );
}
