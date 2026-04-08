import { apiGet, apiPost, apiPatch, apiDelete } from '../client';

// ============================================================================
// Types
// ============================================================================

export type NotificationSeverity = 'info' | 'warn' | 'error' | 'critical';
export type NotificationStatus = 'open' | 'acknowledged' | 'resolved' | 'archived';
export type NotificationSourceType = 'letter' | 'collection' | 'job' | 'admin' | 'system';
export type NotificationGroupBy = 'date' | 'type' | 'source' | 'severity';

export interface AdminNotification {
  id: string;
  type: string;
  severity: NotificationSeverity;
  status: NotificationStatus;
  sourceType: NotificationSourceType | null;
  sourceId: string | null;
  /** Server-rendered friendly label, e.g. "014 · 1864-03-15" — preferred over sourceId. */
  sourceLabel?: string | null;
  title: string;
  message: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  dedupeKey: string | null;
  dedupeCount: number;
  lastOccurredAt: string;
  expiresAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface NotificationListParams {
  type?: string[];
  severity?: NotificationSeverity[];
  status?: NotificationStatus[];
  sourceType?: NotificationSourceType;
  sourceId?: string;
  read?: boolean;
  search?: string;
  from?: string; // ISO datetime
  to?: string; // ISO datetime
  groupBy?: NotificationGroupBy;
  limit?: number;
  offset?: number;
}

export interface NotificationListResponse {
  notifications: AdminNotification[];
  total: number;
  unreadCount: number;
}

export interface NotificationCountsResponse {
  total: number;
  unread: number;
  bySeverity: Record<NotificationSeverity, number>;
  byStatus: Record<NotificationStatus, number>;
}

export interface UnreadCountResponse {
  count: number;
  bySeverity: Record<NotificationSeverity, number>;
  maxSeverity: NotificationSeverity | null;
}

export interface RecentNotificationsResponse {
  notifications: AdminNotification[];
}

// ============================================================================
// Read endpoints
// ============================================================================

function buildListQuery(params?: NotificationListParams): string {
  if (!params) return '';
  const query = new URLSearchParams();

  if (params.type && params.type.length > 0) query.set('type', params.type.join(','));
  if (params.severity && params.severity.length > 0) query.set('severity', params.severity.join(','));
  if (params.status && params.status.length > 0) query.set('status', params.status.join(','));
  if (params.sourceType) query.set('sourceType', params.sourceType);
  if (params.sourceId) query.set('sourceId', params.sourceId);
  if (params.read !== undefined) query.set('read', String(params.read));
  if (params.search) query.set('search', params.search);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.groupBy) query.set('groupBy', params.groupBy);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));

  const qs = query.toString();
  return qs ? '?' + qs : '';
}

export function getNotifications(
  params?: NotificationListParams,
): Promise<NotificationListResponse> {
  return apiGet(`/admin/notifications${buildListQuery(params)}`);
}

export function getNotificationCounts(): Promise<NotificationCountsResponse> {
  return apiGet('/admin/notifications/counts');
}

export function getUnreadCount(): Promise<UnreadCountResponse> {
  return apiGet('/admin/notifications/unread-count');
}

export function getRecentNotifications(): Promise<RecentNotificationsResponse> {
  return apiGet('/admin/notifications/recent');
}

// ============================================================================
// Single-item actions
// ============================================================================

export function markAsRead(id: string): Promise<AdminNotification> {
  return apiPatch<AdminNotification>(`/admin/notifications/${id}/read`, {});
}

export function markAllAsRead(): Promise<{ success: true }> {
  return apiPost('/admin/notifications/read-all', {});
}

export function resolveNotification(id: string): Promise<AdminNotification> {
  return apiPost<AdminNotification>(`/admin/notifications/${id}/resolve`, {});
}

export function archiveNotification(id: string): Promise<AdminNotification> {
  return apiPost<AdminNotification>(`/admin/notifications/${id}/archive`, {});
}

export function deleteNotification(id: string): Promise<void> {
  return apiDelete(`/admin/notifications/${id}`);
}

// ============================================================================
// Bulk actions
// ============================================================================

export function bulkMarkRead(ids: string[]): Promise<{ success: true; count: number }> {
  return apiPost('/admin/notifications/bulk-read', { ids });
}

export function bulkResolve(ids: string[]): Promise<{ success: true; count: number }> {
  return apiPost('/admin/notifications/bulk-resolve', { ids });
}

export function bulkArchive(ids: string[]): Promise<{ success: true; count: number }> {
  return apiPost('/admin/notifications/bulk-archive', { ids });
}

export function bulkDelete(ids: string[]): Promise<{ success: true; count: number }> {
  return apiPost('/admin/notifications/bulk-delete', { ids });
}

// ============================================================================
// Maintenance
// ============================================================================

export function cleanupExpiredNotifications(): Promise<{ success: true; deleted: number }> {
  return apiPost('/admin/notifications/cleanup', {});
}

// ============================================================================
// SSE stream
// ============================================================================

export interface StreamTokenResponse {
  token: string;
  expiresAt: number;
}

export function getStreamToken(): Promise<StreamTokenResponse> {
  return apiPost<StreamTokenResponse>('/admin/notifications/stream-token', {});
}
