import { isNotNull, lt, or } from 'drizzle-orm';
import { adminInvites, db } from '../db/index.js';

export const ADMIN_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export function createAdminInviteExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + ADMIN_INVITE_TTL_MS);
}

export function staleAdminInvitesWhereClause(now: Date = new Date()) {
  return or(
    isNotNull(adminInvites.usedBy),
    lt(adminInvites.expiresAt, now),
  );
}

export async function cleanupStaleAdminInvites(now: Date = new Date()): Promise<void> {
  await db.delete(adminInvites).where(staleAdminInvitesWhereClause(now));
}
