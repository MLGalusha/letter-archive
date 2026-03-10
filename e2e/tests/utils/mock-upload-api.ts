import type { Page } from '@playwright/test';
import { API_BASE_URL } from './test-helpers';

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

export async function installMockUploadApi(
  page: Page,
  options: {
    duplicateMap?: Record<string, boolean>;
    uploadError?: { message: string; requestId: string };
  } = {},
) {
  await page.addInitScript(() => {
    sessionStorage.setItem('adminAuth', 'true');
  });

  const duplicateRequests: string[][] = [];
  const uploadRequests: string[] = [];

  await page.route(
    new RegExp(`${escapeRegex(API_BASE_URL)}/admin/uploads/check-duplicates$`),
    async (route) => {
      const body = route.request().postDataJSON() as { filenames?: string[] };
      const filenames = body.filenames ?? [];
      duplicateRequests.push(filenames);

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
      uploadRequests.push(route.request().url());

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
          success: 2,
          failed: 0,
          results: [
            makeUploadResult('009-19470810-L01-01.jpg'),
            makeUploadResult('009-19470810-L01-02.jpg'),
          ],
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
