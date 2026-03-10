import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installMockUploadApi } from './utils/mock-upload-api';

const collection009UploadFiles = [
  path.resolve(
    process.cwd(),
    '../backend/storage/collections/009/19470810/L01/009-19470810-L01-01.jpg',
  ),
  path.resolve(
    process.cwd(),
    '../backend/storage/collections/009/19470810/L01/009-19470810-L01-02.jpg',
  ),
];

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

    await page.locator('input[type="file"]').first().setInputFiles(collection009UploadFiles);

    await expect(page.locator('.header-stats')).toContainText('2 imported');
    await expect(page.locator('.header-stats')).toContainText('2 original');
    await expect(page.locator('.collections-section')).toContainText('Collection 009');
    expect(mockedApi.duplicateRequests).toEqual([
      ['009-19470810-L01-01.jpg', '009-19470810-L01-02.jpg'],
    ]);

    await page.getByRole('button', { name: 'Upload' }).click();

    await expect(page.locator('.upload-banner')).toContainText('Upload Complete');
    await expect(page.locator('.upload-banner')).toContainText('2 files');
    await expect(page.locator('.upload-banner')).toContainText('1 collection');
    expect(mockedApi.uploadRequests).toHaveLength(1);
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
    await page.locator('input[type="file"]').first().setInputFiles(collection009UploadFiles);

    await page.getByRole('button', { name: 'Upload' }).click();

    await expect(page.locator('.upload-results-panel')).toBeVisible();
    await expect(page.locator('.upload-results-panel')).toContainText('Failed (2)');
    await expect(page.locator('.upload-results-panel')).toContainText(
      'Archive unavailable (Request ID: req-upload-500)',
    );
    expect(mockedApi.uploadRequests).toHaveLength(1);
  });
});
