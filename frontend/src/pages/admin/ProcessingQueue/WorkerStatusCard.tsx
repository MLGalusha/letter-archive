import type { ProcessingWorkerState } from "../../../api/admin/processing";
import { formatTimeAgo } from "./formatters";

interface WorkerStatusCardProps {
  state: ProcessingWorkerState;
}

export default function WorkerStatusCard({ state }: WorkerStatusCardProps) {
  return (
    <div className="proc-worker-card">
      <h2 className="proc-section-title">Background worker</h2>
      <p className="proc-worker-note">
        Persisted observation only; this is not a live connection.
      </p>
      <div className="proc-worker-grid">
        <div>
          <span className="proc-stat-label">Last reported mode</span>
          <span>{state.isPolling ? "Polling" : "Idle"}</span>
        </div>
        <div>
          <span className="proc-stat-label">Last reported</span>
          <span>{formatTimeAgo(state.updatedAt)}</span>
        </div>
        <div>
          <span className="proc-stat-label">Reported batch size</span>
          <span>{state.currentBatchSize ?? "—"}</span>
        </div>
      </div>
      {state.lastError && (
        <p className="proc-worker-error">{state.lastError}</p>
      )}
    </div>
  );
}
