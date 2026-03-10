import { useState, useEffect, useCallback } from 'react';
import { getErrorMessage } from '../../api/client';
import {
  getProcessingQueue,
  startTranscription,
  startMetadataExtraction,
  startEntityExtraction,
  pauseProcessing,
  resumeProcessing,
  abortProcessing,
  removeFromQueue,
  clearQueue,
  retryFailed,
  cancelActiveJob,
  type QueueStatus,
  type QueueJobType,
  type QueueActiveJob,
  type QueuedItem,
  type QueueRecentJob,
} from '../../api/admin';
import { Button } from '../../components/common';
import { useToast } from '../../contexts/ToastContext';
import AdminLayout from '../../components/AdminLayout/AdminLayout';
import './ProcessingQueuePage.css';

type QueueTab = 'transcription' | 'metadata' | 'entityExtraction';

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

  const handleCancel = async (letterId: string, type: QueueJobType) => {
    try {
      await cancelActiveJob(letterId, type);
      showToast('Job cancelled', 'info');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to cancel job'), 'error');
    }
  };

  const handleRemove = async (letterId: string, type: QueueJobType) => {
    try {
      await removeFromQueue(letterId, type);
      showToast('Removed from queue', 'info');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to remove from queue'), 'error');
    }
  };

  const handleClear = async (type: QueueJobType) => {
    try {
      const result = await clearQueue(type);
      showToast(result.message, 'info');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to clear queue'), 'error');
    }
  };

  const handleRetry = async (letterId: string, type: QueueJobType) => {
    try {
      await retryFailed(letterId, type);
      showToast('Job re-queued', 'info');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to retry job'), 'error');
    }
  };

  // On-demand processing controls
  const handleStartTranscription = async () => {
    try {
      const result = await startTranscription();
      showToast(`Started transcription for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to start transcription'), 'error');
    }
  };

  const handleStartMetadata = async () => {
    try {
      const result = await startMetadataExtraction();
      showToast(`Started metadata extraction for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to start metadata extraction'), 'error');
    }
  };

  const handleStartEntities = async () => {
    try {
      const result = await startEntityExtraction();
      showToast(`Started entity extraction for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to start entity extraction'), 'error');
    }
  };

  const handlePause = async () => {
    try {
      await pauseProcessing();
      showToast('Processing paused', 'info');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to pause processing'), 'error');
    }
  };

  const handleResume = async () => {
    try {
      await resumeProcessing();
      showToast('Processing resumed', 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to resume processing'), 'error');
    }
  };

  const handleAbort = async () => {
    try {
      await abortProcessing();
      showToast('Processing aborted', 'info');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to abort processing'), 'error');
    }
  };

  // Derive start handler for current tab
  const startHandlerForTab = activeTab === 'transcription'
    ? handleStartTranscription
    : activeTab === 'metadata'
    ? handleStartMetadata
    : handleStartEntities;

  const startLabelForTab = activeTab === 'transcription'
    ? 'Start Transcription'
    : activeTab === 'metadata'
    ? 'Start Metadata'
    : 'Start Entities';

  if (loading) {
    return (
      <AdminLayout>
        <div className="pq-page">
          <div className="pq-loading">Loading queue status...</div>
        </div>
      </AdminLayout>
    );
  }

  if (!queue) {
    return (
      <AdminLayout>
        <div className="pq-page">
          <div className="pq-loading">Unable to load queue status</div>
        </div>
      </AdminLayout>
    );
  }

  const { counts, onDemandProcessing } = queue;
  const totalQueued = counts.queuedTranscription + counts.queuedMetadata + counts.queuedEntityExtraction;
  const isIdle = !onDemandProcessing.isRunning && !onDemandProcessing.isPaused;
  const batchProgress = onDemandProcessing.total
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

  const currentTabCount = activeTab === 'transcription'
    ? counts.queuedTranscription
    : activeTab === 'metadata'
    ? counts.queuedMetadata
    : counts.queuedEntityExtraction;

  const headerActions = (
    <>
      {isIdle ? (
        <Button onClick={startHandlerForTab} disabled={currentTabCount === 0}>
          {startLabelForTab} ({currentTabCount})
        </Button>
      ) : (
        <div className="pq-header-batch">
          <div className="pq-header-progress">
            <div className="pq-header-progress-bar">
              <div className="pq-header-progress-fill" style={{ width: `${batchProgress}%` }} />
            </div>
            <span className="pq-header-progress-text">
              {onDemandProcessing.completed}/{onDemandProcessing.total}
            </span>
          </div>
          {onDemandProcessing.isPaused ? (
            <Button onClick={handleResume}>Resume</Button>
          ) : (
            <Button onClick={handlePause} variant="secondary">Pause</Button>
          )}
          <Button onClick={handleAbort} variant="danger">Abort</Button>
        </div>
      )}
    </>
  );

  return (
    <AdminLayout headerActions={headerActions}>
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

      {/* Batch errors inline */}
      {onDemandProcessing.errors.length > 0 && (
        <div className="pq-batch-errors">
          <h4>Batch Errors ({onDemandProcessing.errors.length})</h4>
          <div className="pq-error-list">
            {onDemandProcessing.errors.map((error, index) => (
              <div key={index} className="pq-error-item">{error}</div>
            ))}
          </div>
        </div>
      )}

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
                <th>Progress</th>
                <th>Elapsed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.active.map((job: QueueActiveJob) => {
                const progressPct = job.progress && job.progress.totalSteps > 0
                  ? Math.round((job.progress.step / job.progress.totalSteps) * 100)
                  : null;
                return (
                  <tr key={`${job.letterId}-${job.type}`}>
                    <td>
                      <div className="pq-cell-mono">{formatDateRaw(job.letterTitle)}</div>
                      {formatCorrespondents(job.sender, job.recipient) && (
                        <div className="pq-cell-muted">{formatCorrespondents(job.sender, job.recipient)}</div>
                      )}
                    </td>
                    <td>{job.collectionCode}</td>
                    <td><span className="pq-type-badge">{jobTypeLabel(job.type)}</span></td>
                    <td className="pq-progress-cell">
                      {job.progress ? (
                        <>
                          <div className="pq-job-progress-bar">
                            <div className="pq-job-progress-fill" style={{ width: `${progressPct}%` }} />
                          </div>
                          <div className="pq-cell-muted">{job.progress.stepLabel}</div>
                        </>
                      ) : (
                        <span className="pq-cell-muted">Starting...</span>
                      )}
                    </td>
                    <td className="pq-cell-mono">{formatDuration(job.startedAt)}</td>
                    <td>
                      <Button
                        variant="danger"
                        onClick={() => handleCancel(job.letterId, job.type)}
                      >
                        Cancel
                      </Button>
                    </td>
                  </tr>
                );
              })}
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
                  <th>Waiting Since</th>
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
    </div>
    </AdminLayout>
  );
}
