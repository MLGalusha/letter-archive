import { describe, expect, it, vi } from 'vitest';
import { sha256Utf8 } from '../sha256';

describe('sha256Utf8', () => {
  it.each([
    [
      '',
      'e3b0c44298fc1c149afbf4c8996fb924'
      + '27ae41e4649b934ca495991b7852b855',
    ],
    [
      'hello',
      '2cf24dba5fb0a30e26e83b2ac5b9e29e'
      + '1b161e5c1fa7425e73043362938b9824',
    ],
    [
      'Café 🚀\n',
      '91eaf123b3457552e0f63c588d004ae5'
      + 'ba6ed80d265d4ec0932a59c5f56036ab',
    ],
  ])('hashes the exact UTF-8 bytes in %j', async (value, expected) => {
    await expect(sha256Utf8(value)).resolves.toBe(expected);
  });

  it('works when Web Crypto is unavailable on an HTTP LAN origin', async () => {
    vi.stubGlobal('crypto', {});
    try {
      await expect(sha256Utf8('phone review')).resolves.toMatch(
        /^[0-9a-f]{64}$/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
