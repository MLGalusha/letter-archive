import { useState, useCallback, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import {
  startProcess,
  pauseBatch,
  resumeBatch,
  abortBatch,
  removeFromProcessQueue,
  clearProcessQueue,
  retryProcessJob,
  cancelActiveJob,
  type ProcessStatus,
  type ProcessKey,
  type ActiveBatchState,
  type QueuedItem,
  type RecentJob,
  type ObservedWorkerState,
} from '../../api/admin/processes';
import { Button } from '../../components/common';
import { useToast } from '../../contexts/ToastContext';
import AdminLayout from '../../components/AdminLayout/AdminLayout';
import { useProcessingState, type ConnectionState } from '../../hooks/useProcessingState';
import './ProcessingQueuePage.css';

// ============================================================================
// Formatters
// ============================================================================

function formatTimeAgo(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 0) return 'just now';
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
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatDateRaw(dateRaw: string): string {
  if (!dateRaw || dateRaw.length < 4) return dateRaw;
  const year = dateRaw.slice(0, 4);
  const month = dateRaw.length >= 6 ? dateRaw.slice(4, 6) : '';
  const day = dateRaw.length >= 8 ? dateRaw.slice(6, 8) : '';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);
  if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
    return `${months[monthNum - 1]} ${dayNum}, ${year}`;
  }
  if (monthNum >= 1 && monthNum <= 12) {
    return `${months[monthNum - 1]} ${year}`;
  }
  return year;
}

function formatCorrespondents(sender: string | null, recipient: string | null): string {
  if (sender && recipient) return `${sender} → ${recipient}`;
  if (sender) return `From: ${sender}`;
  if (recipient) return `To: ${recipient}`;
  return '';
}

function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Live';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'fallback-polling':
      return 'Polling (SSE unavailable)';
  }
}

// ============================================================================
// Page
// ============================================================================

export default function ProcessingQueuePage() {
  const { showToast } = useToast();
  const { status, loading, error, connectionState, lastUpdatedAt, refresh } =
    useProcessingState();

  // 1-second tick for elapsed time rendering
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const batchProcesses = useMemo(
    () => status?.processes.filter(p => p.group === 'batch') ?? [],
    [status]
  );
  const workerProcess = useMemo(
    () => status?.processes.find(p => p.key === 'background_worker'),
    [status]
  );

  const activeBatch = status?.activeBatch ?? null;

  const handleStart = useCallback(
    async (key: ProcessKey) => {
      try {
        const result = await startProcess(key, {});
        if (result.total === 0) {
          showToast(result.message, 'info');
        } else {
          showToast(`Started ${result.total} ${key} jobs`, 'success');
        }
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, 'Failed to start batch'), 'error');
      }
    },
    [refresh, showToast]
  );

  const handlePause = useCallback(async () => {
    try {
      await pauseBatch();
      await refresh();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to pause'), 'error');
    }
  }, [refresh, showToast]);

  const handleResume = useCallback(async () => {
    try {
      await resumeBatch();
      await refresh();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to resume'), 'error');
    }
  }, [refresh, showToast]);

  const handleAbort = useCallback(async () => {
    if (!window.confirm('Abort the current batch? Jobs in progress will finish.')) return;
    try {
      await abortBatch();
      showToast('Batch abort requested', 'info');
      await refresh();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to abort'), 'error');
    }
  }, [refresh, showToast]);

  const handleRemove = useCallback(
    async (key: ProcessKey, letterId: string) => {
      try {
        await removeFromProcessQueue(key, letterId);
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, 'Failed to remove from queue'), 'error');
      }
    },
    [refresh, showToast]
  );

  const handleClear = useCallback(
    async (key: ProcessKey, label: string) => {
      if (!window.confirm(`Clear the entire ${label} queue?`)) return;
      try {
        const result = await clearProcessQueue(key);
        showToast(`Cleared ${result.cleared} items`, 'info');
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, 'Failed to clear queue'), 'error');
      }
    },
    [refresh, showToast]
  );

  const handleRetry = useCallback(
    async (key: ProcessKey, letterId: string) => {
      try {
        await retryProcessJob(key, letterId);
        showToast('Retry queued', 'info');
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, 'Failed to retry'), 'error');
      }
    },
    [refresh, showToast]
  );

  const handleCancelActive = useCallback(
    async (key: ProcessKey, letterId: string) => {
      if (!window.confirm('Cancel this running job?')) return;
      try {
        await cancelActiveJob(key, letterId);
        showToast('Job cancelled', 'info');
        await refresh();
      } catch (err) {
        showToast(getErrorMessage(err, 'Failed to cancel'), 'error');
      }
    },
    [refresh, showToast]
  );

  return (
    <AdminLayout>
      <div className="proc-page">
        <header className="proc-header">
          <div>
            <p className="proc-kicker">Admin</p>
            <h1 className="proc-title">Processing</h1>
            <p className="proc-subtitle">
              Control center for all background pipelines.
            </p>
          </div>
          <div className="proc-header-meta">
            <span className={`proc-chip proc-chip-${connectionState}`}>
              {connectionLabel(connectionState)}
            </span>
            {lastUpdatedAt && (
              <span className="proc-updated">
                Updated {formatTimeAgo(new Date(lastUpdatedAt).toISOString())}
              </span>
            )}
          </div>
        </header>

        {loading && !status && <p className="proc-loading">Loading…</p>}
        {error && <p className="proc-error">{error}</p>}

        {status && (
          <>
            <section className="proc-cards-row">
              {batchProcesses.map(p => (
                <ProcessCard
                  key={p.key}
                  process={p}
                  isBatchRunning={activeBatch !== null}
                  onStart={() => handleStart(p.key)}
                />
              ))}
            </section>

            {activeBatch && (
              <ActiveBatchPanel
                batch={activeBatch}
                onPause={handlePause}
                onResume={handleResume}
                onAbort={handleAbort}
              />
            )}

            <section className="proc-queues">
              {batchProcesses.map(p => (
                <ProcessQueueSection
                  key={p.key}
                  process={p}
                  onRemove={handleRemove}
                  onClear={handleClear}
                  onCancelActive={handleCancelActive}
                />
              ))}
            </section>

            <section className="proc-recent">
              <h2 className="proc-section-title">Recent activity</h2>
              <RecentActivityList
                processes={batchProcesses}
                onRetry={handleRetry}
              />
            </section>

            {workerProcess?.observed && (
              <section className="proc-observation">
                <WorkerStatusCard state={workerProcess.observed} />
              </section>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}

// ============================================================================
// ProcessCard
// ============================================================================

interface ProcessCardProps {
  process: ProcessStatus;
  isBatchRunning: boolean;
  onStart: () => void;
}

function ProcessCard({ process, isBatchRunning, onStart }: ProcessCardProps) {
  const disableStart = !process.capabilities.start || isBatchRunning || process.eligibleCount === 0;
  return (
    <div className="proc-card" data-key={process.key}>
      <div className="proc-card-head">
        <h3 className="proc-card-title">{process.label}</h3>
        <p className="proc-card-desc">{process.description}</p>
      </div>
      <div className="proc-card-stats">
        <div>
          <span className="proc-stat-label">Eligible</span>
          <span className="proc-stat-value">{process.eligibleCount}</span>
        </div>
        <div>
          <span className="proc-stat-label">Queued</span>
          <span className="proc-stat-value">{process.queued.length}</span>
        </div>
        <div>
          <span className="proc-stat-label">Active</span>
          <span className="proc-stat-value">{process.active ? '1' : '0'}</span>
        </div>
      </div>
      <div className="proc-card-actions">
        <Button onClick={onStart} disabled={disableStart}>
          Start batch
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// ActiveBatchPanel
// ============================================================================

interface ActiveBatchPanelProps {
  batch: ActiveBatchState;
  onPause: () => void;
  onResume: () => void;
  onAbort: () => void;
}

function ActiveBatchPanel({ batch, onPause, onResume, onAbort }: ActiveBatchPanelProps) {
  const total = batch.total || 1;
  const pct = Math.round(((batch.completed + batch.failed) / total) * 100);
  return (
    <section className="proc-active-batch">
      <div className="proc-active-head">
        <h2 className="proc-section-title">
          {batch.processKey.replace('_', ' ')} batch
          {batch.isPaused && <span className="proc-badge proc-badge-paused"> paused</span>}
        </h2>
        <div className="proc-active-actions">
          {batch.isPaused ? (
            <Button onClick={onResume}>Resume</Button>
          ) : (
            <Button onClick={onPause}>Pause</Button>
          )}
          <Button variant="danger" onClick={onAbort}>
            Abort
          </Button>
        </div>
      </div>
      <div className="proc-progress-outer">
        <div className="proc-progress-inner" style={{ width: `${pct}%` }} />
      </div>
      <div className="proc-active-stats">
        <span>
          {batch.completed + batch.failed} / {batch.total}
          {batch.failed > 0 && <> · {batch.failed} failed</>}
        </span>
        <span>Elapsed {formatDuration(batch.startedAt)}</span>
        {batch.currentJob && <span>Current: {batch.currentJob.letterId.slice(0, 8)}</span>}
      </div>
    </section>
  );
}

// ============================================================================
// ProcessQueueSection
// ============================================================================

interface ProcessQueueSectionProps {
  process: ProcessStatus;
  onRemove: (key: ProcessKey, letterId: string) => void;
  onClear: (key: ProcessKey, label: string) => void;
  onCancelActive: (key: ProcessKey, letterId: string) => void;
}

function ProcessQueueSection({
  process,
  onRemove,
  onClear,
  onCancelActive,
}: ProcessQueueSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const count = process.queued.length;
  const active = process.active;

  return (
    <div className="proc-queue-section">
      <div className="proc-queue-head">
        <button
          type="button"
          className="proc-queue-toggle"
          onClick={() => setExpanded(v => !v)}
        >
          <svg
            className={`proc-queue-caret ${expanded ? 'is-open' : ''}`}
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
          <span className="proc-queue-label">{process.label} queue</span>
          <span className="proc-queue-count">{count}</span>
        </button>
        {process.capabilities.clearQueue && count > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onClear(process.key, process.label)}
          >
            Clear queue
          </Button>
        )}
      </div>

      {active && (
        <div className="proc-active-row">
          <div>
            <strong>Running:</strong> {formatDateRaw(active.letterTitle)} ({active.collectionCode})
            {active.progress && (
              <div className="proc-progress-label">
                Step {active.progress.step}/{active.progress.totalSteps}: {active.progress.stepLabel}
              </div>
            )}
          </div>
          {process.capabilities.perItemCancel && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onCancelActive(process.key, active.letterId)}
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      {expanded && count > 0 && (
        <ul className="proc-queue-list">
          {process.queued.map(item => (
            <QueueRow
              key={item.letterId}
              item={item}
              canRemove={process.capabilities.perItemRemove}
              onRemove={() => onRemove(process.key, item.letterId)}
            />
          ))}
        </ul>
      )}
      {expanded && count === 0 && !active && (
        <p className="proc-queue-empty">Queue is empty.</p>
      )}
    </div>
  );
}

interface QueueRowProps {
  item: QueuedItem;
  canRemove: boolean;
  onRemove: () => void;
}

function QueueRow({ item, canRemove, onRemove }: QueueRowProps) {
  return (
    <li className="proc-queue-item">
      <Link to={`/admin/letters/${item.letterId}`} className="proc-queue-item-main">
        <span className="proc-queue-item-title">{formatDateRaw(item.letterTitle)}</span>
        <span className="proc-queue-item-meta">
          {item.collectionCode} · {formatCorrespondents(item.sender, item.recipient)}
        </span>
      </Link>
      <span className="proc-queue-item-time">{formatTimeAgo(item.queuedAt)}</span>
      {canRemove && (
        <Button size="sm" variant="secondary" onClick={onRemove}>
          Remove
        </Button>
      )}
    </li>
  );
}

// ============================================================================
// RecentActivityList
// ============================================================================

interface RecentActivityListProps {
  processes: ProcessStatus[];
  onRetry: (key: ProcessKey, letterId: string) => void;
}

interface RecentRow extends RecentJob {
  processKey: ProcessKey;
  processLabel: string;
}

interface RecentGroup {
  letterId: string;
  letterTitle: string;
  collectionCode: string;
  latestCompletedAt: string;
  steps: RecentRow[];
  successCount: number;
  failedCount: number;
  clearedCount: number;
}

function getGroupStatus(g: RecentGroup): 'SUCCESS' | 'FAILED' | 'CLEARED' {
  if (g.failedCount > 0) return 'FAILED';
  if (g.clearedCount === g.steps.length) return 'CLEARED';
  return 'SUCCESS';
}

function getGroupStatusLabel(g: RecentGroup): string {
  if (g.steps.length === 1) return g.steps[0].status;
  if (g.failedCount > 0) return `${g.successCount}/${g.steps.length}`;
  if (g.clearedCount === g.steps.length) return 'CLEARED';
  return `${g.successCount}/${g.steps.length}`;
}

function RecentActivityList({ processes, onRetry }: RecentActivityListProps) {
  const [filter, setFilter] = useState<'all' | 'SUCCESS' | 'FAILED' | 'CLEARED'>('all');
  const [processFilter, setProcessFilter] = useState<'all' | ProcessKey>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const rows = useMemo<RecentRow[]>(() => {
    const out: RecentRow[] = [];
    for (const p of processes) {
      for (const r of p.recent) {
        out.push({ ...r, processKey: p.key, processLabel: p.label });
      }
    }
    return out;
  }, [processes]);

  const groups = useMemo<RecentGroup[]>(() => {
    // Apply process filter to rows before grouping
    const applicable = processFilter === 'all'
      ? rows
      : rows.filter(r => r.processKey === processFilter);

    const map = new Map<string, RecentRow[]>();
    for (const r of applicable) {
      const existing = map.get(r.letterId);
      if (existing) existing.push(r);
      else map.set(r.letterId, [r]);
    }

    const out: RecentGroup[] = [];
    for (const [letterId, steps] of map) {
      // Sort steps chronologically (oldest first)
      steps.sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
      const latest = steps[steps.length - 1];
      out.push({
        letterId,
        letterTitle: latest.letterTitle,
        collectionCode: latest.collectionCode,
        latestCompletedAt: latest.completedAt,
        steps,
        successCount: steps.filter(s => s.status === 'SUCCESS').length,
        failedCount: steps.filter(s => s.status === 'FAILED').length,
        clearedCount: steps.filter(s => s.status === 'CLEARED').length,
      });
    }

    // Sort groups by most recent step (newest first)
    out.sort((a, b) => new Date(b.latestCompletedAt).getTime() - new Date(a.latestCompletedAt).getTime());
    return out;
  }, [rows, processFilter]);

  // Apply status filter to groups
  const filtered = groups.filter(g => {
    if (filter === 'all') return true;
    return g.steps.some(s => s.status === filter);
  });

  const toggleExpanded = useCallback((letterId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(letterId)) next.delete(letterId);
      else next.add(letterId);
      return next;
    });
  }, []);

  if (rows.length === 0) {
    return <p className="proc-queue-empty">No recent activity.</p>;
  }

  return (
    <div>
      <div className="proc-recent-filters">
        <select
          value={processFilter}
          onChange={e => setProcessFilter(e.target.value as 'all' | ProcessKey)}
        >
          <option value="all">All processes</option>
          {processes.map(p => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
          <option value="all">All statuses</option>
          <option value="SUCCESS">Succeeded</option>
          <option value="FAILED">Failed</option>
          <option value="CLEARED">Cleared</option>
        </select>
      </div>
      <ul className="proc-recent-list">
        {filtered.slice(0, 50).map(group => {
          const isExpanded = expandedIds.has(group.letterId);
          const groupStatus = getGroupStatus(group);
          const isSingleStep = group.steps.length === 1;

          return (
            <li
              key={group.letterId}
              className={`proc-recent-group proc-recent-${groupStatus.toLowerCase()}`}
            >
              <div
                className={`proc-recent-item proc-recent-group-header${!isSingleStep ? ' proc-recent-expandable' : ''}`}
                onClick={!isSingleStep ? () => toggleExpanded(group.letterId) : undefined}
              >
                <div className="proc-recent-main">
                  <Link
                    to={`/admin/letters/${group.letterId}`}
                    onClick={e => e.stopPropagation()}
                  >
                    {formatDateRaw(group.letterTitle)}
                  </Link>
                  <span className="proc-recent-meta">
                    {isSingleStep ? `${group.steps[0].processLabel} · ` : ''}
                    {group.collectionCode} · {formatTimeAgo(group.latestCompletedAt)}
                  </span>
                  {isSingleStep && group.steps[0].error && (
                    <div className="proc-recent-error">{group.steps[0].error}</div>
                  )}
                </div>
                <div className="proc-recent-actions">
                  <span className={`proc-status-pill proc-status-${groupStatus.toLowerCase()}`}>
                    {getGroupStatusLabel(group)}
                  </span>
                  {isSingleStep && group.steps[0].status === 'FAILED' && (
                    <Button
                      size="sm"
                      onClick={e => { e.stopPropagation(); onRetry(group.steps[0].processKey, group.letterId); }}
                    >
                      Retry
                    </Button>
                  )}
                  {!isSingleStep && (
                    <span className={`proc-recent-chevron${isExpanded ? ' proc-recent-chevron-open' : ''}`}>
                      &#9656;
                    </span>
                  )}
                </div>
              </div>

              {isExpanded && !isSingleStep && (
                <ul className="proc-recent-steps">
                  {group.steps
                    .filter(s => processFilter === 'all' || s.processKey === processFilter)
                    .map(step => (
                    <li
                      key={`${step.processKey}-${step.completedAt}`}
                      className={`proc-recent-step proc-recent-${step.status.toLowerCase()}`}
                    >
                      <div className="proc-recent-main">
                        <span className="proc-recent-step-label">{step.processLabel}</span>
                        <span className="proc-recent-meta">{formatTimeAgo(step.completedAt)}</span>
                        {step.error && <div className="proc-recent-error">{step.error}</div>}
                      </div>
                      <div className="proc-recent-actions">
                        <span className={`proc-status-pill proc-status-${step.status.toLowerCase()}`}>
                          {step.status}
                        </span>
                        {step.status === 'FAILED' && (
                          <Button size="sm" onClick={() => onRetry(step.processKey, step.letterId)}>
                            Retry
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// WorkerStatusCard
// ============================================================================

interface WorkerStatusCardProps {
  state: ObservedWorkerState;
}

function WorkerStatusCard({ state }: WorkerStatusCardProps) {
  return (
    <div className="proc-worker-card">
      <h2 className="proc-section-title">Background worker</h2>
      <div className="proc-worker-grid">
        <div>
          <span className="proc-stat-label">Polling</span>
          <span
            className={`proc-dot ${state.isPolling ? 'proc-dot-on' : 'proc-dot-off'}`}
            aria-label={state.isPolling ? 'polling' : 'idle'}
          />
        </div>
        <div>
          <span className="proc-stat-label">Last tick</span>
          <span>{formatTimeAgo(state.lastTickAt)}</span>
        </div>
        <div>
          <span className="proc-stat-label">Batch size</span>
          <span>{state.currentBatchSize ?? '—'}</span>
        </div>
      </div>
      {state.lastError && <p className="proc-worker-error">{state.lastError}</p>}
    </div>
  );
}
