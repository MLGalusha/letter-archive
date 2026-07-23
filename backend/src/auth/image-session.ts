import type { Response } from 'express';

export const IMAGE_SESSION_COOKIE_NAME = 'letter_archive_image_session';
const IMAGE_SESSION_COOKIE_PATH = '/images';
const EXPIRED_COOKIE_DATE = 'Thu, 01 Jan 1970 00:00:00 GMT';

function cookieSecurityAttributes(secure: boolean): string[] {
  return [
    `Path=${IMAGE_SESSION_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ];
}

export function serializeImageSessionCookie(
  token: string,
  secure = process.env.NODE_ENV === 'production',
): string {
  return [
    `${IMAGE_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...cookieSecurityAttributes(secure),
  ].join('; ');
}

export function serializeExpiredImageSessionCookie(
  secure = process.env.NODE_ENV === 'production',
): string {
  return [
    `${IMAGE_SESSION_COOKIE_NAME}=`,
    ...cookieSecurityAttributes(secure),
    'Max-Age=0',
    `Expires=${EXPIRED_COOKIE_DATE}`,
  ].join('; ');
}

export function setImageSessionCookie(res: Response, token: string): void {
  res.setHeader('Set-Cookie', serializeImageSessionCookie(token));
}

export function clearImageSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', serializeExpiredImageSessionCookie());
}

export function readImageSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const segment of cookieHeader.split(';')) {
    const separatorIndex = segment.indexOf('=');
    if (separatorIndex < 0) continue;

    const name = segment.slice(0, separatorIndex).trim();
    if (name !== IMAGE_SESSION_COOKIE_NAME) continue;

    const encodedValue = segment.slice(separatorIndex + 1).trim();
    if (!encodedValue) return null;

    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return null;
    }
  }

  return null;
}
