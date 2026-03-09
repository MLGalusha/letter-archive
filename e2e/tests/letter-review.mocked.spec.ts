import { expect, test, type Page } from '@playwright/test';
import {
  createMockLetterReviewLetter,
  installMockLetterReviewApi,
} from './utils/mock-letter-review-api';
import { API_BASE_URL, SELECTORS } from './utils/test-helpers';

async function openMockLetterReview(page: Page, initialLetter = createMockLetterReviewLetter()) {
  const mockedApi = await installMockLetterReviewApi(page, { initialLetter });
  await page.goto(`/admin/letters/${initialLetter.id}`);
  await page.locator('.letter-review-page').waitFor({ state: 'visible' });
  await page.locator('.viewer-image').waitFor({ state: 'visible' });
  await expect(page.locator(SELECTORS.letterReview.transcriptEditor)).toContainText(
    'My dear mother,',
  );
  return mockedApi;
}

test.describe('@mocked Letter Review', () => {
  test('renders the review page with frozen collection 009 images', async ({
    page,
  }) => {
    await openMockLetterReview(page);

    await expect(page.locator('.filename-value')).toHaveText(
      '009-19470810-L01-01.jpg',
    );
    await expect(page.locator('#sender')).toHaveValue('Alice Smith');
    await expect(page.locator('#recipient')).toHaveValue('Bob Smith');
    await expect(page.locator('.status-panel')).toContainText('Workflow');
    await expect(page.locator('.viewer-image')).toHaveAttribute(
      'src',
      `${API_BASE_URL}/mock-assets/collection-009/19470810/L01/009-19470810-L01-01.jpg`,
    );
  });

  test('pages through real collection 009 images in the viewer', async ({
    page,
  }) => {
    await openMockLetterReview(page);

    await expect(page.locator('.image-counter')).toHaveText('1 / 2');
    await page.locator('.overlay-center .nav-button').nth(1).click();

    await expect(page.locator('.image-counter')).toHaveText('2 / 2');
    await expect(page.locator('.filename-value')).toHaveText(
      '009-19470810-L01-02.jpg',
    );
  });

  test('verifies transcript through the real review UI', async ({ page }) => {
    const mockedApi = await openMockLetterReview(page);

    const transcriptSection = page.locator('.editor-section').first();
    await transcriptSection.locator('.verify-btn').click();

    await expect(page.locator('.toast:has-text("Transcript verified")')).toBeVisible();
    await expect(transcriptSection.locator('.verified-info')).toContainText('Verified');
    await expect(transcriptSection.locator('.transcript-editor')).toHaveAttribute(
      'contenteditable',
      'false',
    );
    expect(mockedApi.verifyTranscriptRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/verify-transcript`,
    ]);
  });

  test('removes transcript verification on double-click', async ({ page }) => {
    const initialLetter = createMockLetterReviewLetter({
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: '2025-03-01T00:00:00.000Z',
      transcript: {
        verified: true,
      },
    });
    const mockedApi = await openMockLetterReview(page, initialLetter);

    const transcriptSection = page.locator('.editor-section').first();
    await transcriptSection.locator('.transcript-editor').dblclick();

    await expect(page.locator('.toast:has-text("Verification removed")')).toBeVisible();
    await expect(transcriptSection.locator('.verify-btn')).toBeVisible();
    await expect(transcriptSection.locator('.transcript-editor')).toHaveAttribute(
      'contenteditable',
      'true',
    );
    expect(mockedApi.unverifyTranscriptRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/unverify-transcript`,
    ]);
  });

  test('verifies metadata and locks the form', async ({ page }) => {
    const mockedApi = await openMockLetterReview(page);

    const metadataSection = page.locator('.metadata-section');
    await metadataSection.locator('.verify-btn').click();

    await expect(page.locator('.toast:has-text("Metadata verified")')).toBeVisible();
    await expect(metadataSection.locator('.verified-info')).toContainText('Verified');
    await expect(page.locator('#sender')).toHaveAttribute('readonly', '');
    expect(mockedApi.verifyMetadataRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/verify-metadata`,
    ]);
  });

  test('removes metadata verification on double-click', async ({ page }) => {
    const initialLetter = createMockLetterReviewLetter({
      metadataContentStatus: 'VERIFIED',
      metadataVerifiedAt: '2025-03-02T00:00:00.000Z',
      metadata: {
        verified: true,
      },
    });
    const mockedApi = await openMockLetterReview(page, initialLetter);

    const metadataSection = page.locator('.metadata-section');
    await metadataSection.locator('.metadata-form').dblclick();

    await expect(page.locator('.toast:has-text("Verification removed")')).toBeVisible();
    await expect(metadataSection.locator('.verify-btn')).toBeVisible();
    await expect(page.locator('#sender')).not.toHaveAttribute('readonly', '');
    expect(mockedApi.unverifyMetadataRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/unverify-metadata`,
    ]);
  });

  test('toggles follow-up flag from the review header', async ({ page }) => {
    const mockedApi = await openMockLetterReview(page);

    const flagButton = page.locator('.header-action.flag');
    await flagButton.click();

    await expect(flagButton).toHaveClass(/active/);
    expect(mockedApi.flagRequests).toEqual([
      {
        url: `${API_BASE_URL}/admin/letters/letter-review-1/flag`,
        body: { flagged: true },
      },
    ]);
  });
});
