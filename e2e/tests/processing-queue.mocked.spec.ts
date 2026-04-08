import { expect, test, type Page } from '@playwright/test';
import { installMockProcessingQueueApi } from './utils/mock-processing-queue-api';

async function openMockProcessingQueue(page: Page) {
  const mockedApi = await installMockProcessingQueueApi(page);
  await page.goto('/admin/processing');
  await page.locator('.proc-page').waitFor({ state: 'visible' });
  // Wait for the first process card to render so we know the snapshot arrived.
  await page.locator('.proc-card').first().waitFor({ state: 'visible' });
  return mockedApi;
}

test.describe('@mocked Processing Queue', () => {
  test('shows an error banner when the snapshot fails to load', async ({ page }) => {
    await installMockProcessingQueueApi(page, {
      snapshotError: {
        message: 'Queue backend unavailable',
        requestId: 'req-queue-load-503',
      },
    });

    await page.goto('/admin/processing');
    await page.locator('.proc-page').waitFor({ state: 'visible' });

    await expect(page.locator('.proc-error')).toContainText('Queue backend unavailable');
    await expect(page.locator('.proc-error')).toContainText('req-queue-load-503');
  });

  test('renders deterministic snapshot data and removes a queued metadata job', async ({
    page,
  }) => {
    const mockedApi = await openMockProcessingQueue(page);

    // All three batch process cards should render.
    const cards = page.locator('.proc-card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('Transcription');
    await expect(cards.nth(1)).toContainText('Metadata extraction');
    await expect(cards.nth(2)).toContainText('Entity extraction');

    // Active batch panel should show the running transcription job.
    await expect(page.locator('.proc-active-batch')).toContainText('transcription');

    // Expand the Metadata queue section and remove the queued item.
    const metadataSection = page
      .locator('.proc-queue-section')
      .filter({ hasText: 'Metadata extraction queue' });
    await metadataSection.locator('.proc-queue-toggle').click();
    await expect(metadataSection).toContainText('August 12, 1947');

    await metadataSection.getByRole('button', { name: 'Remove' }).click();

    await expect(metadataSection).toContainText('Queue is empty.');
    expect(mockedApi.removeRequests).toEqual([
      { letterId: 'letter-3', processKey: 'metadata' },
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

    // Auto-accept the confirm() dialog from the Cancel button.
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/admin/processing');
    await page.locator('.proc-page').waitFor({ state: 'visible' });

    // Expand the transcription queue so the active row + Cancel button render.
    const transcriptionSection = page
      .locator('.proc-queue-section')
      .filter({ hasText: 'Transcription queue' });
    await transcriptionSection.locator('.proc-queue-toggle').click();
    await transcriptionSection.getByRole('button', { name: 'Cancel' }).click();

    const toast = page.locator('.toast-error');
    await expect(toast).toContainText('Job queue stalled');
    await expect(toast).toContainText('req-queue-500');
    expect(mockedApi.cancelRequests).toEqual([
      { letterId: 'letter-1', processKey: 'transcription' },
    ]);
  });

  test('shows the request id when starting transcription fails', async ({ page }) => {
    const mockedApi = await installMockProcessingQueueApi(page, {
      withoutActiveBatch: true,
      startTranscriptionError: {
        message: 'Processing start failed',
        requestId: 'req-start-transcription-503',
      },
    });

    await page.goto('/admin/processing');
    await page.locator('.proc-page').waitFor({ state: 'visible' });
    await page.locator('.proc-card').first().waitFor({ state: 'visible' });

    const transcriptionCard = page
      .locator('.proc-card')
      .filter({ hasText: 'Transcription' })
      .first();
    await transcriptionCard.getByRole('button', { name: 'Start batch' }).click();

    const toast = page.locator('.toast-error');
    await expect(toast).toContainText('Processing start failed');
    await expect(toast).toContainText('req-start-transcription-503');
    expect(mockedApi.startTranscriptionRequests).toHaveLength(1);
  });
});
