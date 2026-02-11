import { useState, useEffect, useCallback } from 'react';
import {
  getProcessingQueue,
  startTranscription,
  startMetadataExtraction,
  pauseProcessing,
  resumeProcessing,
  abortProcessing,
  removeFromQueue,
  clearQueue,
  retryFailed,
  type QueueStatus,
  type QueueJobType,
  type QueueActiveJob,
  type QueuedItem,
  type QueueRecentJob,
} from '../../api/admin';
import { Button } from '../../components/common';
import { useToast } from '../../contexts/ToastContext';
import './ProcessingQueuePage.css';

type QueueTab = 'transcription' | 'metadata' | 'entityExtraction';

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatDuration(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function jobTypeLabel(type: string): string {
  switch (type) {
    case 'transcription': return 'Transcription';
    case 'metadata': return 'Metadata';
    case 'entity_extraction': return 'Entity Extraction';
    default: return type;
  }
}

/** Format YYYYMMDD dateRaw into readable date like "Mar 12, 1888" */
function formatDateRaw(dateRaw: string): string {
  if (!dateRaw || dateRaw.length < 4) return dateRaw;
  const year = dateRaw.slice(0, 4);
  const month = dateRaw.length >= 6 ? dateRaw.slice(4, 6) : '';
  const day = dateRaw.length >= 8 ? dateRaw.slice(6, 8) : '';

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);

  if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
    return `${months[monthNum - 1]} ${dayNum}, ${year}`;
  } else if (monthNum >= 1 && monthNum <= 12) {
    return `${months[monthNum - 1]} ${year}`;
  }
  return year;
}

/** Format sender/recipient into a short description */
function formatCorrespondents(sender: string | null, recipient: string | null): string {
  if (sender && recipient) return `${sender} → ${recipient}`;
  if (sender) return `From: ${sender}`;
  if (recipient) return `To: ${recipient}`;
  return '';
}

export default function ProcessingQueuePage() {
  const { showToast } = useToast();
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<QueueTab>('transcription');
  const [, setTick] = useState(0); // Force re-render for elapsed time

  const fetchQueue = useCallback(async () => {
    try {
      const data = await getProcessingQueue();
      setQueue(data);
    } catch (err) {
      console.error('Failed to fetch queue status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for queue updates
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 2000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  // Tick every second for elapsed time display
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRemove = async (letterId: string, type: QueueJobType) => {
    try {
      await removeFromQueue(letterId, type);
      showToast('Removed from queue', 'info');
      fetchQueue();
    } catch (err) {
      showToast('Failed to remove from queue', 'error');
    }
  };

  const handleClear = async (type: QueueJobType) => {
    try {
      const result = await clearQueue(type);
      showToast(result.message, 'info');
      fetchQueue();
    } catch (err) {
      showToast('Failed to clear queue', 'error');
    }
  };

  const handleRetry = async (letterId: string, type: QueueJobType) => {
    try {
      await retryFailed(letterId, type);
      showToast('Job re-queued', 'info');
      fetchQueue();
    } catch (err) {
      showToast('Failed to retry job', 'error');
    }
  };

  // On-demand processing controls
  const handleStartTranscription = async () => {
    try {
      const result = await startTranscription();
      showToast(`Started transcription for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast('Failed to start transcription', 'error');
    }
  };

  const handleStartMetadata = async () => {
    try {
      const result = await startMetadataExtraction();
      showToast(`Started metadata extraction for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast('Failed to start metadata extraction', 'error');
    }
  };

  const handlePause = async () => {
    try {
      await pauseProcessing();
      showToast('Processing paused', 'info');
      fetchQueue();
    } catch (err) {
      showToast('Failed to pause processing', 'error');
    }
  };

  const handleResume = async () => {
    try {
      await resumeProcessing();
      showToast('Processing resumed', 'success');
      fetchQueue();
    } catch (err) {
      showToast('Failed to resume processing', 'error');
    }
  };

  const handleAbort = async () => {
    try {
      await abortProcessing();
      showToast('Processing aborted', 'info');
      fetchQueue();
    } catch (err) {
      showToast('Failed to abort processing', 'error');
    }
  };

  if (loading) {
    return (
      <div className="pq-page">
        <div className="pq-loading">Loading queue status...</div>
      </div>
    );
  }

  if (!queue) {
    return (
      <div className="pq-page">
        <div className="pq-loading">Unable to load queue status</div>
      </div>
    );
  }

  const { counts, onDemandProcessing } = queue;
  const totalQueued = counts.queuedTranscription + counts.queuedMetadata + counts.queuedEntityExtraction;
  const isIdle = !onDemandProcessing.isRunning && !onDemandProcessing.isPaused;
  const progress = onDemandProcessing.total
    ? Math.round((onDemandProcessing.completed / onDemandProcessing.total) * 100)
    : 0;

  const queuedItems: QueuedItem[] = activeTab === 'transcription'
    ? queue.queued.transcription
    : activeTab === 'metadata'
    ? queue.queued.metadata
    : queue.queued.entityExtraction;

  const queueTabType: QueueJobType = activeTab === 'entityExtraction'
    ? 'entity_extraction'
    : activeTab;

  return (
    <div className="pq-page">
      <h2 className="pq-title">Processing Queue</h2>

      {/* Summary Bar */}
      <div className="pq-summary">
        <div className={`pq-summary-chip ${counts.activeCount > 0 ? 'active' : ''}`}>
          <span className="pq-chip-count">{counts.activeCount}</span>
          <span className="pq-chip-label">Active</span>
        </div>
        <div className={`pq-summary-chip ${totalQueued > 0 ? 'queued' : ''}`}>
          <span className="pq-chip-count">{totalQueued}</span>
          <span className="pq-chip-label">Queued</span>
        </div>
        <div className={`pq-summary-chip ${counts.recentSuccessCount > 0 ? 'success' : ''}`}>
          <span className="pq-chip-count">{counts.recentSuccessCount}</span>
          <span className="pq-chip-label">Done</span>
        </div>
        <div className={`pq-summary-chip ${counts.recentFailedCount > 0 ? 'failed' : ''}`}>
          <span className="pq-chip-count">{counts.recentFailedCount}</span>
          <span className="pq-chip-label">Failed</span>
        </div>
      </div>

      {/* Active Jobs */}
      {queue.active.length > 0 && (
        <section className="pq-section">
          <h3>Active Jobs</h3>
          <table className="pq-table">
            <thead>
              <tr>
                <th>Letter</th>
                <th>Collection</th>
                <th>Type</th>
                <th>Elapsed</th>
              </tr>
            </thead>
            <tbody>
              {queue.active.map((job: QueueActiveJob) => (
                <tr key={`${job.letterId}-${job.type}`}>
                  <td>
                    <div className="pq-cell-mono">{formatDateRaw(job.letterTitle)}</div>
                    {formatCorrespondents(job.sender, job.recipient) && (
                      <div className="pq-cell-muted">{formatCorrespondents(job.sender, job.recipient)}</div>
                    )}
                  </td>
                  <td>{job.collectionCode}</td>
                  <td><span className="pq-type-badge">{jobTypeLabel(job.type)}</span></td>
                  <td className="pq-cell-mono">{formatDuration(job.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Queue Section */}
      <section className="pq-section">
        <h3>Queue</h3>
        <div className="pq-tabs">
          <button
            className={`pq-tab ${activeTab === 'transcription' ? 'active' : ''}`}
            onClick={() => setActiveTab('transcription')}
          >
            Transcription ({counts.queuedTranscription})
          </button>
          <button
            className={`pq-tab ${activeTab === 'metadata' ? 'active' : ''}`}
            onClick={() => setActiveTab('metadata')}
          >
            Metadata ({counts.queuedMetadata})
          </button>
          <button
            className={`pq-tab ${activeTab === 'entityExtraction' ? 'active' : ''}`}
            onClick={() => setActiveTab('entityExtraction')}
          >
            Entities ({counts.queuedEntityExtraction})
          </button>
        </div>

        {queuedItems.length > 0 ? (
          <>
            <table className="pq-table">
              <thead>
                <tr>
                  <th>Letter</th>
                  <th>Collection</th>
                  <th>Queued</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {queuedItems.map((item: QueuedItem) => (
                  <tr key={item.letterId}>
                    <td>
                      <div className="pq-cell-mono">{formatDateRaw(item.letterTitle)}</div>
                      {formatCorrespondents(item.sender, item.recipient) && (
                        <div className="pq-cell-muted">{formatCorrespondents(item.sender, item.recipient)}</div>
                      )}
                    </td>
                    <td>{item.collectionCode}</td>
                    <td className="pq-cell-muted">{formatTimeAgo(item.queuedAt)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => handleRemove(item.letterId, queueTabType)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pq-queue-footer">
              <Button
                variant="danger"
                onClick={() => handleClear(queueTabType)}
              >
                Clear All {jobTypeLabel(queueTabType)} Queue
              </Button>
            </div>
          </>
        ) : (
          <div className="pq-empty">No {jobTypeLabel(queueTabType).toLowerCase()} jobs queued</div>
        )}
      </section>

      {/* Recent Activity */}
      {queue.recent.length > 0 && (
        <section className="pq-section">
          <h3>Recent Activity</h3>
          <table className="pq-table">
            <thead>
              <tr>
                <th>Letter</th>
                <th>Collection</th>
                <th>Type</th>
                <th>Status</th>
                <th>Time</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.recent.map((job: QueueRecentJob, i: number) => (
                <tr key={`${job.letterId}-${job.type}-${i}`}>
                  <td className="pq-cell-mono">{formatDateRaw(job.letterTitle)}</td>
                  <td>{job.collectionCode}</td>
                  <td><span className="pq-type-badge">{jobTypeLabel(job.type)}</span></td>
                  <td>
                    <span className={`pq-status ${job.status === 'SUCCESS' ? 'success' : 'failed'}`}>
                      {job.status === 'SUCCESS' ? 'Done' : 'Failed'}
                    </span>
                    {job.error && (
                      <span className="pq-error-hint" title={job.error}>(?)</span>
                    )}
                  </td>
                  <td className="pq-cell-muted">{formatTimeAgo(job.completedAt)}</td>
                  <td>
                    {job.status === 'FAILED' && (
                      <Button
                        variant="ghost"
                        onClick={() => handleRetry(job.letterId, job.type)}
                      >
                        Retry
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Batch Controls */}
      <section className="pq-section pq-batch-controls">
        <div className="pq-batch-header">
          <h3>Batch Processing</h3>
          <span className={`status-badge ${onDemandProcessing.isRunning ? 'running' : onDemandProcessing.isPaused ? 'paused' : 'idle'}`}>
            {onDemandProcessing.isRunning ? 'Running' : onDemandProcessing.isPaused ? 'Paused' : 'Idle'}
          </span>
        </div>

        {onDemandProcessing.currentJob && (
          <div className="pq-current-job">
            <span className="pq-cell-muted">Current:</span>
            <span className="pq-type-badge">{onDemandProcessing.currentJob.type}</span>
            <span className="pq-cell-mono">{onDemandProcessing.currentJob.letterId.slice(0, 8)}...</span>
          </div>
        )}

        {onDemandProcessing.total > 0 && (
          <div className="pq-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-stats">
              <span>{onDemandProcessing.completed} / {onDemandProcessing.total} completed</span>
              <span>{onDemandProcessing.failed} failed</span>
            </div>
          </div>
        )}

        <div className="pq-batch-buttons">
          {isIdle ? (
            <>
              <Button onClick={handleStartTranscription}>Start Transcription</Button>
              <Button onClick={handleStartMetadata} variant="secondary">Start Metadata Extraction</Button>
            </>
          ) : (
            <>
              {onDemandProcessing.isPaused ? (
                <Button onClick={handleResume}>Resume</Button>
              ) : (
                <Button onClick={handlePause} variant="secondary">Pause</Button>
              )}
              <Button onClick={handleAbort} variant="danger">Abort</Button>
            </>
          )}
        </div>

        {onDemandProcessing.errors.length > 0 && (
          <div className="pq-batch-errors">
            <h4>Errors ({onDemandProcessing.errors.length})</h4>
            <div className="pq-error-list">
              {onDemandProcessing.errors.map((error, index) => (
                <div key={index} className="pq-error-item">{error}</div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
