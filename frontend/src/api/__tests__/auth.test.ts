import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  apiDeleteMock,
  apiGetMock,
  apiPostMock,
} = vi.hoisted(() => ({
  apiDeleteMock: vi.fn(),
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
}));

vi.mock('../client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../client')>()),
  apiDelete: apiDeleteMock,
  apiGet: apiGetMock,
  apiPost: apiPostMock,
}));

import {
  ensureImageSession,
  login,
  logout,
} from '../auth';

describe('admin image-session client lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('establishes one image session for an existing stored bearer', async () => {
    localStorage.setItem('adminToken', 'existing-bearer');
    apiPostMock.mockResolvedValue(undefined);

    await Promise.all([
      ensureImageSession(),
      ensureImageSession(),
    ]);

    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).toHaveBeenCalledWith('/auth/image-session');
  });

  it('recognizes the image cookie issued by login without a redundant refresh', async () => {
    apiPostMock.mockResolvedValueOnce({
      token: 'new-login-bearer',
      email: 'admin@example.test',
    });

    await login('admin@example.test', 'password');
    await ensureImageSession();

    expect(localStorage.getItem('adminToken')).toBe('new-login-bearer');
    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).toHaveBeenCalledWith('/auth/login', {
      email: 'admin@example.test',
      password: 'password',
    });
  });

  it('clears the stored bearer only after the HttpOnly cookie is expired', async () => {
    localStorage.setItem('adminToken', 'logout-bearer');
    apiDeleteMock.mockResolvedValue(undefined);

    await logout();

    expect(apiDeleteMock).toHaveBeenCalledWith('/auth/image-session');
    expect(localStorage.getItem('adminToken')).toBeNull();
  });

  it('keeps the bearer available for retry when secure logout fails', async () => {
    localStorage.setItem('adminToken', 'retryable-bearer');
    apiDeleteMock.mockRejectedValue(new Error('network unavailable'));

    await expect(logout()).rejects.toThrow('network unavailable');
    expect(localStorage.getItem('adminToken')).toBe('retryable-bearer');
  });
});
