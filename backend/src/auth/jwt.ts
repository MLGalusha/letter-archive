import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { env } from '../config/env.js';

const SALT_ROUNDS = 12;

export interface JwtPayload {
  userId: string;
  email: string;
  exp?: number;
}

export interface ImageSessionJwtPayload extends JwtPayload {
  purpose: 'image-session';
}

/**
 * Hash a plaintext password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a signed JWT token for an authenticated admin user
 */
export function generateToken(userId: string, email: string): string {
  const payload: JwtPayload = { userId, email };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRY as StringValue });
}

/**
 * Generate a credential that is accepted only by the image-serving boundary.
 *
 * When an API bearer mints this credential, `expiresAt` keeps the image
 * session from outliving that bearer.
 */
export function generateImageSessionToken(
  userId: string,
  email: string,
  expiresAt?: number,
): string {
  const payload: ImageSessionJwtPayload = {
    userId,
    email,
    purpose: 'image-session',
  };

  if (expiresAt !== undefined) {
    return jwt.sign({ ...payload, exp: expiresAt }, env.JWT_SECRET);
  }

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRY as StringValue,
  });
}

/**
 * Verify and decode a JWT token. Returns the payload or null if invalid.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload & {
      purpose?: unknown;
    };
    if (decoded.purpose !== undefined) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Verify a token minted specifically for image access.
 */
export function verifyImageSessionToken(token: string): ImageSessionJwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as Partial<ImageSessionJwtPayload>;
    if (
      decoded.purpose !== 'image-session'
      || typeof decoded.userId !== 'string'
      || typeof decoded.email !== 'string'
    ) {
      return null;
    }
    return decoded as ImageSessionJwtPayload;
  } catch {
    return null;
  }
}
