import { apiGet, apiPut, apiPost, apiDelete } from '../client';

interface SiteSettings {
  [key: string]: string;
}

interface InviteInfo {
  id: string;
  token: string;
  email: string | null;
  invitedBy: string;
  inviterEmail: string;
  usedBy: string | null;
  expiresAt: string;
  createdAt: string;
  status: 'pending' | 'used' | 'expired';
}

interface SystemInfo {
  openaiEnabled: boolean;
  corsOrigins: string;
  letterCount: number;
  totalLetters: number;
  collectionCount: number;
  pendingQueue: number;
}

export type { SiteSettings, InviteInfo, SystemInfo };

export function getSettings(): Promise<SiteSettings> { return apiGet('/admin/settings'); }
export function updateSettings(settings: SiteSettings): Promise<SiteSettings> { return apiPut('/admin/settings', settings); }
export function getInvites(): Promise<InviteInfo[]> { return apiGet('/admin/settings/invites'); }
export function revokeInvite(id: string): Promise<void> { return apiDelete(`/admin/settings/invites/${id}`); }
export function changePassword(oldPassword: string, newPassword: string): Promise<void> { return apiPost('/admin/settings/change-password', { oldPassword, newPassword }); }
export function getSystemInfo(): Promise<SystemInfo> { return apiGet('/admin/settings/system-info'); }
