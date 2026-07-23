import { describe, expect, it } from 'vitest';
import {
  IMAGE_SESSION_COOKIE_NAME,
  readImageSessionCookie,
  serializeExpiredImageSessionCookie,
  serializeImageSessionCookie,
} from '../image-session.js';
import {
  generateImageSessionToken,
  generateToken,
  verifyImageSessionToken,
  verifyToken,
} from '../jwt.js';

describe('image session boundary', () => {
  it('keeps API bearer and image-session JWT purposes separate', () => {
    const apiToken = generateToken('admin-1', 'admin@example.test');
    const imageToken = generateImageSessionToken(
      'admin-1',
      'admin@example.test',
      Math.floor(Date.now() / 1000) + 60,
    );

    expect(verifyToken(apiToken)).toMatchObject({
      userId: 'admin-1',
      email: 'admin@example.test',
    });
    expect(verifyImageSessionToken(imageToken)).toMatchObject({
      userId: 'admin-1',
      email: 'admin@example.test',
      purpose: 'image-session',
    });
    expect(verifyToken(imageToken)).toBeNull();
    expect(verifyImageSessionToken(apiToken)).toBeNull();
  });

  it('serializes a host-only, image-scoped HttpOnly cookie for production', () => {
    const cookie = serializeImageSessionCookie('image.jwt.value', true);

    expect(cookie).toBe(
      `${IMAGE_SESSION_COOKIE_NAME}=image.jwt.value; Path=/images; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(cookie).not.toContain('Domain=');
  });

  it('uses the same scope and security attributes when clearing the cookie', () => {
    const cookie = serializeExpiredImageSessionCookie(true);

    expect(cookie).toContain(`${IMAGE_SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('Path=/images');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=0');
  });

  it('reads only the exact image-session cookie and fails closed on bad encoding', () => {
    expect(
      readImageSessionCookie(
        `theme=dark; ${IMAGE_SESSION_COOKIE_NAME}=image.jwt.value; session=other`,
      ),
    ).toBe('image.jwt.value');
    expect(readImageSessionCookie(`${IMAGE_SESSION_COOKIE_NAME}=%E0%A4%A`)).toBeNull();
    expect(readImageSessionCookie('adminToken=reusable-admin-jwt')).toBeNull();
  });
});
