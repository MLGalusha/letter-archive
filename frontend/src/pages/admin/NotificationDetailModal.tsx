import { useNavigate } from 'react-router-dom';
import { Modal, Button } from '../../components/common';
import Icon from '../../components/common/Icon';
import type { IconName } from '../../components/common/Icon';
import type { AdminNotification, NotificationSeverity } from '../../api/admin/notifications';
import './NotificationDetailModal.css';

interface Props {
  notification: AdminNotification | null;
  onClose: () => void;
  onResolve: (id: string) => void | Promise<void>;
  onArchive: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: 'Info',
  warn: 'Warning',
  error: 'Error',
  critical: 'Critical',
};

function getTypeIcon(type: string): IconName {
  if (type.startsWith('upload')) return 'upload';
  if (type.startsWith('transcription')) return 'edit';
  if (type.startsWith('metadata')) return 'file';
  if (type.startsWith('entity')) return 'person';
  if (type.startsWith('batch')) return 'folder';
  if (type.startsWith('job')) return 'process';
  if (type.startsWith('api')) return 'external-link';
  if (type.startsWith('collection_profile')) return 'newspaper';
  if (type.startsWith('queue')) return 'process';
  if (type.startsWith('system') || type.startsWith('sweeper')) return 'settings';
  if (type === 'migrations_pending' || type === 'stub_mode_active') return 'flag';
  if (type === 'admin_joined' || type === 'admin_login_failed') return 'lock';
  if (type === 'ai_notes_high_priority') return 'sticky-note';
  return 'bell';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function shortSourceId(id: string): string {
  // Full UUID → first 8 chars with ellipsis; leave friendly IDs alone
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id.slice(0, 8) + '…';
  }
  return id;
}

function humanType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** camelCase / snake_case → "Title case with spaces". Exported for tests. */
export function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/** Render a metadata value compactly for primitives, JSON for objects/arrays. Exported for tests. */
export function formatMetadataValue(value: unknown): { display: string; isCode: boolean } {
  if (value === null || value === undefined) return { display: '—', isCode: false };
  if (typeof value === 'string') return { display: value, isCode: false };
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { display: String(value), isCode: false };
  }
  if (Array.isArray(value)) {
    // Short arrays of primitives → comma-joined; otherwise pretty JSON
    const allPrim = value.every((v) => typeof v !== 'object' || v === null);
    if (allPrim && value.length <= 8) {
      return { display: value.map((v) => String(v)).join(', '), isCode: false };
    }
    return { display: JSON.stringify(value, null, 2), isCode: true };
  }
  return { display: JSON.stringify(value, null, 2), isCode: true };
}

export default function NotificationDetailModal({
  notification,
  onClose,
  onResolve,
  onArchive,
  onDelete,
}: Props) {
  const navigate = useNavigate();

  if (!notification) return null;

  const n = notification;
  const severityLabel = SEVERITY_LABEL[n.severity];
  const statusLabel = n.status.charAt(0).toUpperCase() + n.status.slice(1);

  const metadataEntries =
    n.metadata && typeof n.metadata === 'object'
      ? Object.entries(n.metadata as Record<string, unknown>)
      : [];

  const handleOpenSource = () => {
    if (n.link) {
      navigate(n.link);
      onClose();
    }
  };

  const handleResolve = async () => {
    await onResolve(n.id);
    onClose();
  };

  const handleArchive = async () => {
    await onArchive(n.id);
    onClose();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this notification? This cannot be undone.')) return;
    await onDelete(n.id);
    onClose();
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={n.title}
      size="md"
      actions={
        <div className="notif-modal-footer">
          <div className="notif-modal-footer-left">
            {n.status !== 'resolved' && n.status !== 'archived' && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleResolve}
                className="notif-modal-action notif-modal-action-resolve"
              >
                Resolve
              </Button>
            )}
            {n.status !== 'archived' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleArchive}
                className="notif-modal-action notif-modal-action-archive"
              >
                Archive
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              className="notif-modal-action notif-modal-action-delete"
            >
              Delete
            </Button>
          </div>
          <div className="notif-modal-footer-right">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            {n.link && (
              <Button variant="primary" size="sm" onClick={handleOpenSource}>
                <span>Open source</span>
                <Icon name="arrow-right" size={14} />
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="notif-modal-body">
        <div className={`notif-modal-hero sev-${n.severity}`}>
          <div className="notif-modal-icon">
            <Icon name={getTypeIcon(n.type)} size={22} />
          </div>
          <div className="notif-modal-badges">
            <span className={`notif-modal-badge sev-${n.severity}`}>{severityLabel}</span>
            <span className={`notif-modal-badge status-${n.status}`}>{statusLabel}</span>
            {n.dedupeCount > 1 && (
              <span className="notif-modal-badge dedupe">
                ×{n.dedupeCount} occurrences
              </span>
            )}
          </div>
        </div>

        {n.message && <p className="notif-modal-message">{n.message}</p>}

        <dl className="notif-modal-meta">
          <dt>Type</dt>
          <dd>
            <code>{humanType(n.type)}</code>
          </dd>

          {n.sourceType && (
            <>
              <dt>Source</dt>
              <dd>
                <span className="notif-modal-source-type">{n.sourceType}</span>
                {n.sourceLabel ? (
                  <span className="notif-modal-source-label">{n.sourceLabel}</span>
                ) : (
                  n.sourceId && (
                    <code className="notif-modal-source-id" title={n.sourceId}>
                      {shortSourceId(n.sourceId)}
                    </code>
                  )
                )}
              </dd>
            </>
          )}

          <dt>First seen</dt>
          <dd>{formatDate(n.createdAt)}</dd>

          {n.lastOccurredAt && n.lastOccurredAt !== n.createdAt && (
            <>
              <dt>Last seen</dt>
              <dd>{formatDate(n.lastOccurredAt)}</dd>
            </>
          )}

          {n.resolvedAt && (
            <>
              <dt>Resolved</dt>
              <dd>
                {formatDate(n.resolvedAt)}
                {n.resolvedBy && <span className="notif-modal-resolved-by"> by {n.resolvedBy}</span>}
              </dd>
            </>
          )}

          {n.expiresAt && (
            <>
              <dt>Expires</dt>
              <dd>{formatDate(n.expiresAt)}</dd>
            </>
          )}
        </dl>

        {metadataEntries.length > 0 && (
          <div className="notif-modal-metadata">
            <div className="notif-modal-metadata-label">Details</div>
            <dl className="notif-modal-meta">
              {metadataEntries.map(([key, value]) => {
                const { display, isCode } = formatMetadataValue(value);
                return (
                  <div key={key} className="notif-modal-meta-row">
                    <dt>{humanizeKey(key)}</dt>
                    <dd>{isCode ? <code>{display}</code> : <span>{display}</span>}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>
    </Modal>
  );
}
