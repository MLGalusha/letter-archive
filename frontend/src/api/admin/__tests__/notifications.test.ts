import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATIONS_CHANGED_EVENT } from '../../../services/notificationEvents';
import * as notifications from '../notifications';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../client', () => ({ apiGet: request, apiPost: request, apiPatch: request, apiDelete: request }));

const mutations = [
  () => notifications.markAsRead('one'),
  () => notifications.markAllAsRead(),
  () => notifications.resolveNotification('one'),
  () => notifications.archiveNotification('one'),
  () => notifications.deleteNotification('one'),
  () => notifications.bulkMarkRead(['one']),
  () => notifications.bulkResolve(['one']),
  () => notifications.bulkArchive(['one']),
  () => notifications.bulkDelete(['one']),
  () => notifications.cleanupExpiredNotifications(),
];

afterEach(() => { vi.restoreAllMocks(); request.mockReset(); });

describe('notification mutation invalidation', () => {
  it.each(mutations.map((mutate, index) => ({ mutate, index })))('invalidates only after successful mutation $index', async ({ mutate }) => {
    const events = vi.spyOn(window, 'dispatchEvent');
    let resolve!: (value: unknown) => void;
    request.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = mutate();
    expect(events).not.toHaveBeenCalled();
    const response = { success: true };
    resolve(response);
    expect(await pending).toBe(response);
    expect(events).toHaveBeenCalledTimes(1);
    expect(events.mock.calls[0][0].type).toBe(NOTIFICATIONS_CHANGED_EVENT);
    events.mockClear();
    request.mockRejectedValueOnce(new Error('Rejected'));
    await expect(mutate()).rejects.toThrow('Rejected');
    expect(events).not.toHaveBeenCalled();
  });

  it('does not invalidate for reads or stream-token creation', async () => {
    const events = vi.spyOn(window, 'dispatchEvent');
    request.mockResolvedValue({});
    await Promise.all([notifications.getUnreadCount(), notifications.getRecentNotifications(), notifications.getStreamToken()]);
    expect(events).not.toHaveBeenCalled();
  });
});
