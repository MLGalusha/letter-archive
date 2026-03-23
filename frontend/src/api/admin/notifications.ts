import { apiGet, apiPost, apiDelete } from '../client';

export interface AdminNotification {
  id: string;
  type: string; // 'transcription', 'metadata', 'entity', 'upload', 'batch', 'admin', 'error', 'system'
  title: string;
  message: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

interface NotificationListResponse {
  notifications: AdminNotification[];
  total: number;
  unreadCount: number;
}

interface UnreadCountResponse {
  count: number;
}

export function getNotifications(params?: {
  type?: string;
  read?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<NotificationListResponse> {
  const query = new URLSearchParams();
  if (params?.type) query.set('type', params.type);
  if (params?.read !== undefined) query.set('read', String(params.read));
  if (params?.search) query.set('search', params.search);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return apiGet(`/admin/notifications${qs ? '?' + qs : ''}`);
}

export function getUnreadCount(): Promise<UnreadCountResponse> {
  return apiGet('/admin/notifications/unread-count');
}

export function markAsRead(id: string): Promise<void> {
  return apiPost(`/admin/notifications/${id}/read`, {});
}

export function markAllAsRead(): Promise<void> {
  return apiPost('/admin/notifications/read-all', {});
}

export function deleteNotification(id: string): Promise<void> {
  return apiDelete(`/admin/notifications/${id}`);
}
