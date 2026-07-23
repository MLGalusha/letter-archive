import type { Page } from '@playwright/test';
import {
  API_BASE_URL,
  installMockImageSessionApi,
} from './test-helpers';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeUploadResult(filename: string) {
  return {
    filename,
    letterId: `letter-${filename}`,
    pageId: `page-${filename}`,
    collectionCode: filename.slice(0, 3),
    storagePath: `/uploads/${filename}`,
    alreadyExists: false,
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
        }),
      });
    },
  );

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/uploads(?:\\?force=true)?$`),
    async (route) => {
      const filenames = extractUploadedFilenames(route.request().postDataBuffer());
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
          results: filenames.map(makeUploadResult),
          errors: [],
        }),
      });
    },
  );

  return {
    duplicateRequests,
    uploadRequests,
  };
}
