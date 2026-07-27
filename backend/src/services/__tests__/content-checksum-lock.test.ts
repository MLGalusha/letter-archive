import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  releaseMock,
  reserveMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  reserveMock: vi.fn(),
}));

vi.mock('../../db/index.js', () => {
  const reserved = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => (
      queryMock([...strings], values)
    ),
    { release: releaseMock },
  );
  return {
    sql: {
      reserve: reserveMock.mockResolvedValue(reserved),
    },
  };
});

import { withContentChecksumLock } from '../content-checksum-lock.js';

describe('content checksum session lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([]);
  });

  it('holds one reserved session and releases the checksum lock after failure', async () => {
    await expect(withContentChecksumLock(
      'checksum-a',
      async () => {
        throw new Error('upload failed');
      },
    )).rejects.toThrow('upload failed');

    expect(reserveMock).toHaveBeenCalledOnce();
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0]?.[0].join('')).toContain('pg_advisory_lock');
    expect(queryMock.mock.calls[1]?.[0].join('')).toContain('pg_advisory_unlock');
    expect(queryMock.mock.calls[0]?.[1]).toEqual(['checksum-a']);
    expect(queryMock.mock.calls[1]?.[1]).toEqual(['checksum-a']);
    expect(releaseMock).toHaveBeenCalledOnce();
  });
});
