import { db, adminNotifications } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'notifications' });

interface CreateNotificationParams {
  type: string;
  title: string;
  message?: string;
  link?: string;
}

/**
 * Create an admin notification. Fire-and-forget — never let notification
 * creation break the main flow.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    await db.insert(adminNotifications).values({
      type: params.type,
      title: params.title,
      message: params.message || null,
      link: params.link || null,
    });
  } catch (err) {
    // Never let notification creation break the main flow
    log.error({ err, params }, 'Failed to create notification');
  }
}
