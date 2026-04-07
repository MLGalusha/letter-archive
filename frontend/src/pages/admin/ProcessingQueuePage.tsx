import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import {
  getProcessingQueue,
  startTranscription,
  startMetadataExtraction,
  startEntityExtraction,
  startLineDetection,
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

type QueueTab = 'transcription' | 'metadata' | 'entity_extraction' | 'line_detection';

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
    case 'entity_extraction': return 'Entities';
    case 'entity_resolution': return 'Resolution';
    case 'line_detection': return 'Lines';
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
  if (sender && recipient) return `${sender} \u2192 ${recipient}`;
  if (sender) return `From: ${sender}`;
  if (recipient) return `To: ${recipient}`;
  return '';
}

export default function ProcessingQueuePage() {
  const { showToast } = useToast();
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<QueueTab>('transcription');
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [, setTick] = useState(0);

  const fetchQueue = useCallback(async () => {
    try {
      const data = await getProcessingQueue();
      setQueue(data);
    } catch (err) {
      // Silently ignore polling failures — don't spam toasts every 2 seconds
      console.debug('Queue poll failed:', err);
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

  // Collect unique collection codes from all queued items
  const collectionCodes = useMemo(() => {
    if (!queue) return [];
    const codes = new Set<string>();
    queue.queued.transcription.forEach(i => codes.add(i.collectionCode));
    queue.queued.metadata.forEach(i => codes.add(i.collectionCode));
    queue.queued.entityExtraction.forEach(i => codes.add(i.collectionCode));
    return Array.from(codes).sort();
  }, [queue]);

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

  const handleStartTranscription = async () => {
    try {
      const options = collectionFilter !== 'all' ? { collectionCode: collectionFilter } : undefined;
      const result = await startTranscription(options);
      showToast(`Started transcription for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to start transcription'), 'error');
    }
  };

  const handleStartMetadata = async () => {
    try {
      const options = collectionFilter !== 'all' ? { collectionCode: collectionFilter } : undefined;
      const result = await startMetadataExtraction(options);
      showToast(`Started metadata extraction for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to start metadata extraction'), 'error');
    }
  };

  const handleStartEntities = async () => {
    try {
      const options = collectionFilter !== 'all' ? { collectionCode: collectionFilter } : undefined;
      const result = await startEntityExtraction(options);
      showToast(`Started entity extraction for ${result.total} letters`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to start entity extraction'), 'error');
    }
  };

  const handleStartLineDetection = async () => {
    try {
      const result = await startLineDetection();
      showToast(`Started line detection for ${result.total} pages`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to start line detection'), 'error');
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

  const toggleErrorExpanded = (index: number) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

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
  const isIdle = !onDemandProcessing.isRunning && !onDemandProcessing.isPaused;
  const batchProgress = onDemandProcessing.total
    ? Math.round((onDemandProcessing.completed / onDemandProcessing.total) * 100)
    : 0;

  // Queue items for the active tab, filtered by collection
  const allQueuedItems: QueuedItem[] = activeTab === 'transcription'
    ? queue.queued.transcription
    : activeTab === 'metadata'
      ? queue.queued.metadata
      : activeTab === 'entity_extraction'
        ? queue.queued.entityExtraction
        : []; // line_detection has no individual items

  const queuedItems = collectionFilter === 'all'
    ? allQueuedItems
    : allQueuedItems.filter(i => i.collectionCode === collectionFilter);

  const queueTabType: QueueJobType = activeTab === 'line_detection' ? 'transcription' : activeTab; // line_detection doesn't use queue management

  // Pipeline phase data
  const phases = [
    { key: 'transcription' as const, label: 'Transcription', count: counts.queuedTranscription, handler: handleStartTranscription },
    { key: 'metadata' as const, label: 'Metadata', count: counts.queuedMetadata, handler: handleStartMetadata },
    { key: 'entity_extraction' as const, label: 'Entities', count: counts.queuedEntityExtraction, handler: handleStartEntities },
    { key: 'line_detection' as const, label: 'Line Detection', count: counts.queuedLineDetection, handler: handleStartLineDetection },
  ];

  // Determine which phase is currently running
  const runningPhaseType = onDemandProcessing.currentJob?.type ?? null;

  // Header global controls
  const headerActions = !isIdle ? (
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
        <Button onClick={handleResume} size="sm">Resume</Button>
      ) : (
        <Button onClick={handlePause} variant="secondary" size="sm">Pause</Button>
      )}
      <Button onClick={handleAbort} variant="danger" size="sm">Abort</Button>
    </div>
  ) : undefined;

  return (
    <AdminLayout headerActions={headerActions}>
    <div className="pq-page">
      {/* Page Header */}
      <div className="pq-header">
        <div>
          <p className="pq-kicker">Admin</p>
          <h2 className="pq-title">Processing Queue</h2>
          <p className="pq-subtitle">Pipeline overview, active jobs, and queue management</p>
        </div>
      </div>

      {/* Pipeline Status Overview */}
      <div className="pq-pipeline">
        {phases.map((phase, i) => {
          const isRunning = !isIdle && runningPhaseType === phase.key;
          return (
            <div key={phase.key} className="pq-pipeline-row">
              <div className={`pq-phase-card ${isRunning ? 'running' : ''}`}>
                <div className="pq-phase-number">{i + 1}</div>
                <div className="pq-phase-body">
                  <h3 className="pq-phase-name">{phase.label}</h3>
                  <span className="pq-phase-count">
                    {phase.count} ready
                  </span>
                  {isRunning ? (
                    <div className="pq-phase-running">
                      <div className="pq-phase-progress-bar">
                        <div className="pq-phase-progress-fill" style={{ width: `${batchProgress}%` }} />
                      </div>
                      <span className="pq-phase-progress-text">
                        {onDemandProcessing.completed}/{onDemandProcessing.total}
                      </span>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={phase.handler}
                      disabled={phase.count === 0 || !isIdle}
                    >
                      Start
                    </Button>
                  )}
                </div>
              </div>
              {i < phases.length - 1 && (
                <div className="pq-pipeline-arrow">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9,18 15,12 9,6" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active Jobs */}
      <section className="pq-section">
        <h3 className="pq-section-title">Active Jobs</h3>
        {queue.active.length > 0 ? (
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
                      <Link to={`/admin/letters/${job.letterId}`} className="pq-letter-link">
                        {formatDateRaw(job.letterTitle)}
                      </Link>
                      {formatCorrespondents(job.sender, job.recipient) && (
                        <div className="pq-cell-muted">{formatCorrespondents(job.sender, job.recipient)}</div>
                      )}
                    </td>
                    <td><span className="pq-collection-badge">{job.collectionCode}</span></td>
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
                        size="sm"
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
        ) : (
          <div className="pq-empty-state">
            <span className="pq-empty-icon">&#9711;</span>
            <span>No active jobs</span>
          </div>
        )}
      </section>

      {/* Queue Section */}
      <section className="pq-section">
        <div className="pq-section-header">
          <h3 className="pq-section-title">Queue</h3>
          <div className="pq-collection-filter">
            <label htmlFor="pq-filter">Collection:</label>
            <select
              id="pq-filter"
              value={collectionFilter}
              onChange={e => setCollectionFilter(e.target.value)}
            >
              <option value="all">All</option>
              {collectionCodes.map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="pq-tabs">
          {phases.map(phase => (
            <button
              key={phase.key}
              className={`pq-tab ${activeTab === phase.key ? 'active' : ''}`}
              onClick={() => setActiveTab(phase.key)}
            >
              {phase.label} ({phase.count})
            </button>
          ))}
        </div>

        {activeTab === 'line_detection' ? (
          <div className="pq-empty-state">
            <span>{counts.queuedLineDetection} page{counts.queuedLineDetection !== 1 ? 's' : ''} missing line segments</span>
          </div>
        ) : queuedItems.length > 0 ? (
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
                      <Link to={`/admin/letters/${item.letterId}`} className="pq-letter-link">
                        {formatDateRaw(item.letterTitle)}
                      </Link>
                      {formatCorrespondents(item.sender, item.recipient) && (
                        <div className="pq-cell-muted">{formatCorrespondents(item.sender, item.recipient)}</div>
                      )}
                    </td>
                    <td><span className="pq-collection-badge">{item.collectionCode}</span></td>
                    <td className="pq-cell-muted">{formatTimeAgo(item.queuedAt)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
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
                size="sm"
                onClick={() => handleClear(queueTabType)}
              >
                Clear All
              </Button>
            </div>
          </>
        ) : (
          <div className="pq-empty-state">
            <span>No {jobTypeLabel(activeTab).toLowerCase()} jobs queued</span>
          </div>
        )}
      </section>

      {/* Recent Activity */}
      <section className="pq-section">
        <div className="pq-section-header">
          <h3 className="pq-section-title">Recent Activity</h3>
          {queue.recent.length > 0 && (
            <span className="pq-recent-summary">
              {counts.recentSuccessCount} done{counts.recentClearedCount > 0 ? `, ${counts.recentClearedCount} cleared` : ''}{counts.recentFailedCount > 0 ? `, ${counts.recentFailedCount} failed` : ''}
            </span>
          )}
        </div>

        {queue.recent.length > 0 ? (
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
              {queue.recent.map((job: QueueRecentJob, i: number) => {
                const isFailed = job.status === 'FAILED';
                const isCleared = job.status === 'CLEARED';
                const isExpanded = expandedErrors.has(i);
                return (
                  <tr
                    key={`${job.letterId}-${job.type}-${i}`}
                    className={isFailed ? 'pq-row-failed' : ''}
                  >
                    <td>
                      <Link to={`/admin/letters/${job.letterId}`} className="pq-letter-link">
                        {formatDateRaw(job.letterTitle)}
                      </Link>
                    </td>
                    <td><span className="pq-collection-badge">{job.collectionCode}</span></td>
                    <td><span className="pq-type-badge">{jobTypeLabel(job.type)}</span></td>
                    <td>
                      <div className="pq-status-cell">
                        <span className={`pq-status ${job.status === 'SUCCESS' ? 'success' : isCleared ? 'cleared' : 'failed'}`}>
                          {job.status === 'SUCCESS' ? 'Done' : isCleared ? 'Cleared' : 'Failed'}
                        </span>
                        {isFailed && job.error && (
                          <button
                            className="pq-error-toggle"
                            onClick={() => toggleErrorExpanded(i)}
                            title="Toggle error details"
                          >
                            {isExpanded ? '\u25B4' : '\u25BE'}
                          </button>
                        )}
                      </div>
                      {isFailed && job.error && isExpanded && (
                        <div className="pq-error-detail">{job.error}</div>
                      )}
                    </td>
                    <td className="pq-cell-muted">{formatTimeAgo(job.completedAt)}</td>
                    <td>
                      {isFailed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRetry(job.letterId, job.type)}
                        >
                          Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="pq-empty-state">
            <span>No recent activity</span>
          </div>
        )}
      </section>
    </div>
    </AdminLayout>
  );
}
