import { isAbsolute, relative, resolve } from 'node:path';
import { isDevelopmentStubTranscription } from '../../ai/openai/transcription-stub.js';
const LOCAL_DATABASE_HOSTS = new Set([
  '127.0.0.1',
  '::1',
  '[::1]',
  'localhost',
]);

export function assertBenchmarkTranscriptPageEligible(input: {
  letterKey: string;
  pageNumber: number;
  text: string;
}): void {
  if (isDevelopmentStubTranscription(input.text)) {
    throw new Error(
      `${input.letterKey} Page ${input.pageNumber} contains the known development stub transcription`,
    );
  }
}

export function assertLocalDatabaseUrl(databaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Snapshot DATABASE_URL must be a valid local PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Snapshot DATABASE_URL must use PostgreSQL');
  }
  if (
    !LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())
    || parsed.searchParams.has('host')
  ) {
    throw new Error('Transcript snapshots may only read a local TCP PostgreSQL database');
  }
  return parsed;
}

export function assertPathInside(
  allowedRoot: string,
  candidate: string,
): string {
  const root = resolve(allowedRoot);
  const target = resolve(candidate);
  const pathFromRoot = relative(root, target);
  if (
    target === root
    || isAbsolute(pathFromRoot)
    || pathFromRoot === '..'
    || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw new Error(`Path must be a file below ${root}`);
  }
  return target;
}
