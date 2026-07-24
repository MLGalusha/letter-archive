import type { Page } from '@playwright/test';
import {
  API_BASE_URL,
  installMockImageSessionApi,
} from './test-helpers';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeUploadResult(filename: string, force: boolean) {
  return {
    filename,
    letterId: `letter-${filename}`,
    pageId: `page-${filename}`,
    collectionCode: filename.slice(0, 3),
    storagePath: `/uploads/${filename}`,
    primarySourceRevision: 8,
    alreadyExists: force,
    outcome: force ? 'replaced' as const : 'created' as const,
    changed: true,
  };
}

function extractUploadedFilenames(body: Buffer | null): string[] {
  if (!body) return [];

  const filenames = new Set<string>();
  const text = body.toString('utf8');
  const filenamePattern = /filename="([^"]+)"/g;

  for (const match of text.matchAll(filenamePattern)) {
    if (match[1]) {
      filenames.add(match[1]);
    }
  }

  return Array.from(filenames);
}

interface UploadSourceExpectation {
  pageId: string;
  primarySourceRevision: number;
  storagePath: string;
  checksumSha256: string | null;
}

function extractSourceExpectations(
  body: Buffer | null,
): Record<string, UploadSourceExpectation> | undefined {
  if (!body) return undefined;
  const match = body
    .toString('utf8')
    .match(/name="sourceExpectations"\r?\n\r?\n([^\r\n]+)/);
  if (!match?.[1]) return undefined;
  return JSON.parse(match[1]) as Record<string, UploadSourceExpectation>;
}

export async function installMockUploadApi(
  page: Page,
  options: {
    duplicateMap?: Record<string, boolean>;
    duplicateError?: { message: string; requestId: string };
    uploadError?: { message: string; requestId: string };
  } = {},
) {
  await installMockImageSessionApi(page);

  await page.addInitScript(() => {
    localStorage.setItem('adminToken', 'mock-token');
  });

  const duplicateRequests: string[][] = [];
  const uploadRequests: Array<{ url: string; filenames: string[] }> = [];
  const forceSourceExpectations: Array<
    Record<string, UploadSourceExpectation>
  > = [];

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/uploads/check-duplicates$`),
    async (route) => {
      const body = route.request().postDataJSON() as { filenames?: string[] };
      const filenames = body.filenames ?? [];
      duplicateRequests.push(filenames);

       if (options.duplicateError) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          headers: {
            'x-request-id': options.duplicateError.requestId,
          },
          body: JSON.stringify({
            error: options.duplicateError.message,
            requestId: options.duplicateError.requestId,
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          duplicates: Object.fromEntries(
            filenames.map((filename) => [filename, options.duplicateMap?.[filename] ?? false]),
          ),
          sourceExpectations: Object.fromEntries(
            filenames.map((filename) => [
              filename,
              options.duplicateMap?.[filename]
                ? {
                    pageId: `page-${filename}`,
                    primarySourceRevision: 7,
                    storagePath: `/uploads/${filename}`,
                    checksumSha256: `checksum-${filename}`,
                  }
                : null,
            ]),
          ),
        }),
      });
    },
  );

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/uploads(?:\\?force=true)?$`),
    async (route) => {
      const filenames = extractUploadedFilenames(route.request().postDataBuffer());
      const force = new URL(route.request().url()).searchParams.get('force') === 'true';
      if (force) {
        const sourceExpectations = extractSourceExpectations(
          route.request().postDataBuffer(),
        );
        if (sourceExpectations) forceSourceExpectations.push(sourceExpectations);
      }
      uploadRequests.push({
        url: route.request().url(),
        filenames,
      });

      if (options.uploadError) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: {
            'x-request-id': options.uploadError.requestId,
          },
          body: JSON.stringify({
            error: options.uploadError.message,
            requestId: options.uploadError.requestId,
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: filenames.length,
          failed: 0,
          results: filenames.map((filename) => makeUploadResult(filename, force)),
          errors: [],
          summary: {
            accepted: filenames.length,
            failed: 0,
            changed: filenames.length,
            unchanged: 0,
            created: force ? 0 : filenames.length,
            replaced: force ? filenames.length : 0,
            affectedLetters: filenames.length,
          },
        }),
      });
    },
  );

  return {
    duplicateRequests,
    uploadRequests,
    forceSourceExpectations,
  };
}
