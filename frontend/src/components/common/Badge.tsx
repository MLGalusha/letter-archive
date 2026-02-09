import type { WorkflowState, VisibilityState } from '../../types/Letter';
import './Badge.css';

/* ============================================================================
   Base Badge
   ============================================================================ */

export interface BadgeProps {
  children: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'purple';
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  );
}

/* ============================================================================
   Workflow Badge
   ============================================================================ */

const WORKFLOW_CONFIG: Record<WorkflowState, { label: string; variant: BadgeProps['variant'] }> = {
  UPLOADED: { label: 'Uploaded', variant: 'warning' },
  TRANSCRIBING: { label: 'Transcribing', variant: 'info' },
  TRANSCRIBED: { label: 'Transcribed', variant: 'info' },
  METADATA_EXTRACTING: { label: 'Extracting', variant: 'info' },
  METADATA_DRAFTED: { label: 'Metadata Ready', variant: 'purple' },
  REVIEWED: { label: 'Reviewed', variant: 'success' },
};

export interface WorkflowBadgeProps {
  state: WorkflowState;
  className?: string;
}

export function WorkflowBadge({ state, className = '' }: WorkflowBadgeProps) {
  const config = WORKFLOW_CONFIG[state] || { label: state, variant: 'default' };
  return (
    <Badge variant={config.variant} className={`badge-workflow ${className}`}>
      {config.label}
    </Badge>
  );
}

/* ============================================================================
   Visibility Badge
   ============================================================================ */

// Map visibility states - includes legacy DRAFT fallback to HIDDEN
const VISIBILITY_CONFIG: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  PUBLISHED: { label: 'Published', variant: 'success' },
  HIDDEN: { label: 'Hidden', variant: 'muted' },
  DRAFT: { label: 'Hidden', variant: 'muted' }, // Legacy fallback
};

export interface VisibilityBadgeProps {
  state: VisibilityState | string; // Allow string for legacy DRAFT values
  className?: string;
}

export function VisibilityBadge({ state, className = '' }: VisibilityBadgeProps) {
  // Normalize legacy DRAFT to HIDDEN
  const normalizedState = state === 'DRAFT' ? 'HIDDEN' : state;
  const config = VISIBILITY_CONFIG[normalizedState] || { label: 'Hidden', variant: 'muted' };
  return (
    <Badge variant={config.variant} className={`badge-visibility ${className}`}>
      {config.label}
    </Badge>
  );
}

/* ============================================================================
   Type Badge (for document types: Letter, Photo, etc)
   ============================================================================ */

const TYPE_CONFIG: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  L: { label: 'Letter', variant: 'default' },
  P: { label: 'Photo', variant: 'info' },
  E: { label: 'Extra', variant: 'muted' },
  V: { label: 'Voice', variant: 'warning' },
  A: { label: 'Article', variant: 'default' },
  D: { label: 'Diary', variant: 'default' },
  C: { label: 'Cover', variant: 'muted' },
  N: { label: 'Card', variant: 'info' },
  T: { label: 'Telegram', variant: 'warning' },
};

export interface TypeBadgeProps {
  type: string;
  className?: string;
}

export function TypeBadge({ type, className = '' }: TypeBadgeProps) {
  const config = TYPE_CONFIG[type] || { label: type, variant: 'default' };
  return (
    <Badge variant={config.variant} className={`badge-type ${className}`}>
      {config.label}
    </Badge>
  );
}

/* ============================================================================
   Status Badge (generic status indicator)
   ============================================================================ */

export interface StatusBadgeProps {
  status: 'auto' | 'manual' | 'pending' | 'complete' | 'error';
  label?: string;
  className?: string;
}

export function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const variants: Record<string, BadgeProps['variant']> = {
    auto: 'info',
    manual: 'default',
    pending: 'muted',
    complete: 'success',
    error: 'danger',
  };

  const labels: Record<string, string> = {
    auto: 'Auto',
    manual: 'Manual',
    pending: 'Pending',
    complete: 'Complete',
    error: 'Error',
  };

  return (
    <Badge variant={variants[status] || 'default'} className={`badge-status ${className}`}>
      {label || labels[status] || status}
    </Badge>
  );
}

export default Badge;
