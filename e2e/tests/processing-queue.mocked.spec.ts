import { expect, test, type Page } from '@playwright/test';
import { installMockProcessingQueueApi } from './utils/mock-processing-queue-api';

async function openMockProcessingQueue(page: Page) {
  const mockedApi = await installMockProcessingQueueApi(page);
  await page.goto('/admin/processing');
  await page.locator('.pq-page').waitFor({ state: 'visible' });
  await page.locator('.pq-table').first().waitFor({ state: 'visible' });
  return mockedApi;
}

test.describe('@mocked Processing Queue', () => {
  test('renders deterministic queue data and removes a queued metadata job', async ({
    page,
  }) => {
    const mockedApi = await openMockProcessingQueue(page);
    const activeSection = page.locator('.pq-section').nth(0);
    const queueSection = page.locator('.pq-section').nth(1);

    await expect(page.locator('.pq-summary')).toContainText('Active');
    await expect(page.locator('.pq-summary')).toContainText('Queued');
    await expect(activeSection).toContainText('Alice Smith');
    await expect(activeSection).toContainText('OCR');

    await page.locator('.pq-tab:has-text("Metadata (1)")').click();
    await expect(queueSection).toContainText('Ellen Gray');

    await queueSection.getByRole('button', { name: 'Remove' }).click();

    await expect(page.locator('.pq-empty')).toContainText('No metadata jobs queued');
    expect(mockedApi.removeRequests).toEqual([
      {
        letterId: 'letter-3',
        type: 'metadata',
      },
    ]);
  });

  test('shows the request id when cancelling an active job fails', async ({
    page,
  }) => {
    const mockedApi = await installMockProcessingQueueApi(page, {
      cancelError: {
        message: 'Job queue stalled',
        requestId: 'req-queue-500',
      },
    });

    await page.goto('/admin/processing');
    await page.locator('.pq-page').waitFor({ state: 'visible' });

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('.toast-error')).toContainText('Job queue stalled');
    await expect(page.locator('.toast-error')).toContainText('Request ID: req-queue-500');
    expect(mockedApi.cancelRequests).toEqual([
      {
        letterId: 'letter-1',
        type: 'transcription',
      },
    ]);
  });
});
