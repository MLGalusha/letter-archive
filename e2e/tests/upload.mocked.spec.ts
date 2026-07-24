import { access } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installMockUploadApi } from './utils/mock-upload-api';

const collection009UploadFixtures = [
  {
    name: '009-19470810-L01-01.jpg',
    filePath: path.resolve(
      process.cwd(),
      '../backend/storage/collections/009/19470810/L01/009-19470810-L01-01.jpg',
    ),
  },
  {
    name: '009-19470810-L01-02.jpg',
    filePath: path.resolve(
      process.cwd(),
      '../backend/storage/collections/009/19470810/L01/009-19470810-L01-02.jpg',
    ),
  },
] as const;

const fallbackJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

async function setCollection009UploadFiles(page: Page) {
  const input = page.locator('input[type="file"]').first();

  try {
    await Promise.all(
      collection009UploadFixtures.map((fixture) => access(fixture.filePath)),
    );
    await input.setInputFiles(
      collection009UploadFixtures.map((fixture) => fixture.filePath),
    );
    return;
  } catch {
    await input.setInputFiles(
      collection009UploadFixtures.map((fixture) => ({
        name: fixture.name,
        mimeType: 'image/jpeg',
        buffer: fallbackJpegBytes,
      })),
    );
  }
}

async function openMockUploadPage(page: Page) {
  const mockedApi = await installMockUploadApi(page);
  await page.goto('/admin/upload');
  await page.locator('.upload-letter-page').waitFor({ state: 'visible' });
  return mockedApi;
}

test.describe('@mocked Upload Page', () => {
  test('imports frozen collection 009 files and completes a mocked upload', async ({
    page,
  }) => {
    const mockedApi = await openMockUploadPage(page);

    await setCollection009UploadFiles(page);

    await expect(page.locator('.header-stats')).toContainText('2 imported');
    await expect(page.locator('.header-stats')).toContainText('2 original');
    await expect(page.locator('.collections-section')).toContainText('Collection 009');
    expect(mockedApi.duplicateRequests).toEqual([
      ['009-19470810-L01-01.jpg', '009-19470810-L01-02.jpg'],
    ]);

    await page.getByRole('button', { name: 'Upload' }).click();

    await expect.poll(() => mockedApi.uploadRequests.length).toBe(1);
    expect(mockedApi.uploadRequests).toEqual([
      {
        url: expect.stringMatching(/\/admin\/uploads$/),
        filenames: [
          '009-19470810-L01-01.jpg',
          '009-19470810-L01-02.jpg',
        ],
      },
    ]);
    await expect(page.locator('.upload-banner')).toHaveCount(0);
    await expect(page.locator('.upload-drop-zone')).toContainText('Drag images here');
  });

  test('shows request ids in upload failures for the real browser workflow', async ({
    page,
  }) => {
    const mockedApi = await installMockUploadApi(page, {
      uploadError: {
        message: 'Archive unavailable',
        requestId: 'req-upload-500',
      },
    });

    await page.goto('/admin/upload');
    await page.locator('.upload-letter-page').waitFor({ state: 'visible' });
    await setCollection009UploadFiles(page);

    await page.getByRole('button', { name: 'Upload' }).click();

    await expect(page.locator('.upload-results-panel')).toBeVisible();
    await expect(page.locator('.upload-results-panel')).toContainText('Failed (2)');
    await expect(page.locator('.upload-results-panel')).toContainText(
      'Archive unavailable (Request ID: req-upload-500)',
    );
    expect(mockedApi.uploadRequests).toHaveLength(1);
  });

  test('shows request ids when duplicate checking fails during import', async ({
    page,
  }) => {
    const mockedApi = await installMockUploadApi(page, {
      duplicateError: {
        message: 'Duplicate checker unavailable',
        requestId: 'req-dupe-check-503',
      },
    });

    await page.goto('/admin/upload');
    await page.locator('.upload-letter-page').waitFor({ state: 'visible' });
    await setCollection009UploadFiles(page);

    await expect(
      page.locator('.toast.toast-error').filter({
        hasText: 'Duplicate checker unavailable (Request ID: req-dupe-check-503)',
      }),
    ).toBeVisible();
    await expect(page.locator('.collections-section')).toContainText('Collection 009');
    expect(mockedApi.duplicateRequests).toEqual([
      ['009-19470810-L01-01.jpg', '009-19470810-L01-02.jpg'],
    ]);
    expect(mockedApi.uploadRequests).toHaveLength(0);
  });

  test('skips duplicate files in the real browser upload workflow', async ({
    page,
  }) => {
    const mockedApi = await installMockUploadApi(page, {
      duplicateMap: {
        '009-19470810-L01-01.jpg': true,
        '009-19470810-L01-02.jpg': false,
      },
    });

    await page.goto('/admin/upload');
    await page.locator('.upload-letter-page').waitFor({ state: 'visible' });
    await setCollection009UploadFiles(page);

    await expect(page.locator('.header-stats')).toContainText('1 duplicate');
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.locator('.duplicate-dialog')).toContainText('Duplicates Found');
    await page.getByRole('button', { name: /Skip Duplicates/i }).click();

    await expect.poll(() => mockedApi.uploadRequests.length).toBe(1);
    expect(mockedApi.uploadRequests).toEqual([
      {
        url: expect.stringMatching(/\/admin\/uploads$/),
        filenames: ['009-19470810-L01-02.jpg'],
      },
    ]);
    await expect(page.locator('.upload-banner')).toHaveCount(0);
    await expect(page.locator('.upload-drop-zone')).toContainText('Drag images here');
  });

  test('replaces duplicate files through the real browser upload workflow', async ({
    page,
  }) => {
    const mockedApi = await installMockUploadApi(page, {
      duplicateMap: {
        '009-19470810-L01-01.jpg': true,
        '009-19470810-L01-02.jpg': false,
      },
    });

    await page.goto('/admin/upload');
    await page.locator('.upload-letter-page').waitFor({ state: 'visible' });
    await setCollection009UploadFiles(page);

    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.locator('.duplicate-dialog')).toContainText('Duplicates Found');
    await page.getByRole('button', { name: /Replace Duplicates/i }).click();

    // Wait for both batch requests to complete (new files + force replacements)
    await expect.poll(() => mockedApi.uploadRequests.length, { timeout: 5000 }).toBe(2);
    expect(mockedApi.uploadRequests).toEqual([
      {
        url: expect.stringMatching(/\/admin\/uploads$/),
        filenames: ['009-19470810-L01-02.jpg'],
      },
      {
        url: expect.stringMatching(/\/admin\/uploads\?force=true$/),
        filenames: ['009-19470810-L01-01.jpg'],
      },
    ]);
    expect(mockedApi.forceSourceExpectations).toEqual([{
      '009-19470810-L01-01.jpg': {
        pageId: 'page-009-19470810-L01-01.jpg',
        primarySourceRevision: 8,
        storagePath: '/uploads/009-19470810-L01-01.jpg',
        checksumSha256: 'checksum-009-19470810-L01-01.jpg',
      },
    }]);
    await expect(page.locator('.upload-banner')).toHaveCount(0);
    await expect(page.locator('.upload-drop-zone')).toContainText('Drag images here');
  });
});
