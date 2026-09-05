import { beforeEach, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const { insert, values, onConflictDoUpdate, select, from } = vi.hoisted(() => ({
  insert: vi.fn(), values: vi.fn(), onConflictDoUpdate: vi.fn(), select: vi.fn(), from: vi.fn(),
}));
vi.mock('../../../db/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../db/index.js')>(), db: { insert, select },
}));
import settingsRouter from '../settings.js';

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockReturnValue({ values });
  values.mockReturnValue({ onConflictDoUpdate });
  onConflictDoUpdate.mockResolvedValue(undefined);
  select.mockReturnValue({ from });
  from.mockResolvedValue([
    { key: 'site_title', value: 'Letter Archive', updatedAt: new Date() },
    { key: 'siteTitle', value: 'Letter Archive', updatedAt: new Date() },
  ]);
});

it('saves canonical and legacy settings together and returns both to existing clients', async () => {
  const response = await invokeRouter(settingsRouter, {
    method: 'PUT', url: '/settings', path: '/settings',
    headers: { 'content-type': 'application/json' }, body: { site_title: 'Letter Archive' },
  });
  expect(response.statusCode).toBe(200);
  expect(insert).toHaveBeenCalledTimes(1);
  expect(values).toHaveBeenCalledWith([
    { key: 'site_title', value: 'Letter Archive' }, { key: 'siteTitle', value: 'Letter Archive' },
  ]);
  expect(response.body).toMatchObject({ site_title: 'Letter Archive', siteTitle: 'Letter Archive' });
});
