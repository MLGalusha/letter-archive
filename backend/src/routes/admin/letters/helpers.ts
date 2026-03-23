import type { Request } from 'express';
import { z } from 'zod';
import { fetchLetterWithRelatedAndTransform } from '../../../services/letter-queries.js';
import { getLetterById } from '../../../services/letters.js';
import { AppError, BadRequestError, NotFoundError } from '../../../utils/response-helpers.js';

export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  message: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestError(message, parsed.error.errors);
  }
  return parsed.data;
}

export function requireString(value: unknown, message: string): string {
  if (!value || typeof value !== 'string') {
    throw new BadRequestError(message);
  }
  return value;
}

export function requireFieldType(value: unknown): 'transcript' | 'metadata' {
  if (value === 'transcript' || value === 'metadata') {
    return value;
  }
  throw new BadRequestError('fieldType query param required (transcript or metadata)');
}

export function requirePositiveInt(value: string, message = 'Invalid version number'): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    throw new BadRequestError(message);
  }
  return parsed;
}

export async function requireLetter(letterId: string, message = 'Letter not found') {
  const letter = await getLetterById(letterId);
  if (!letter) {
    throw new NotFoundError(message);
  }
  return letter;
}

export async function requireLetterDto(
  letterId: string,
  message = 'Letter not found after update',
  statusCode = 404,
) {
  const letter = await fetchLetterWithRelatedAndTransform(letterId);
  if (!letter) {
    if (statusCode === 404) {
      throw new NotFoundError(message);
    }
    throw new AppError(statusCode, message);
  }
  return letter;
}

export function getUserId(req: Request): string {
  return req.user?.userId ?? 'admin';
}
