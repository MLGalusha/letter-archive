import { expect, test, type Page } from '@playwright/test';
import {
  createMockLetterReviewLetter,
  installMockLetterReviewApi,
} from './utils/mock-letter-review-api';
import { API_BASE_URL } from './utils/test-helpers';

async function openMockLetterReview(page: Page, initialLetter = createMockLetterReviewLetter()) {
  const mockedApi = await installMockLetterReviewApi(page, { initialLetter });
  await page.goto(`/admin/letters/${initialLetter.id}`);
  await page.locator('.letter-review-page').waitFor({ state: 'visible' });
  await page.locator('.viewer-image').waitFor({ state: 'visible' });
  await expect(page.locator('.transcript-editor').first()).toContainText(
    'My dear mother,',
  );
  return mockedApi;
}

async function openMockLetterReviewWithOptions(
  page: Page,
  initialLetter = createMockLetterReviewLetter(),
  options: Omit<Parameters<typeof installMockLetterReviewApi>[1], 'initialLetter'> = {},
) {
  const mockedApi = await installMockLetterReviewApi(page, {
    initialLetter,
    ...options,
  });
  await page.goto(`/admin/letters/${initialLetter.id}`);
  await page.locator('.letter-review-page').waitFor({ state: 'visible' });
  await page.locator('.viewer-image').waitFor({ state: 'visible' });
  await expect(page.locator('.transcript-editor').first()).toContainText(
    'My dear mother,',
  );
  return mockedApi;
}

function createMockLetterWithExtras(
  overrides: Parameters<typeof createMockLetterReviewLetter>[0] = {},
) {
  const baseLetter = createMockLetterReviewLetter(overrides);
  return createMockLetterReviewLetter({
    extraContentStatus: 'AI_DRAFT',
    extraContentTranscript: 'Envelope note from the cover.',
    ...overrides,
    images: [
      ...baseLetter.images,
      {
        id: 'collection-009-cover-1',
        type: 'cover',
        imageUrl: '/mock-assets/collection-009/19470810/L01/009-19470810-L01-02.jpg',
        pageNumber: baseLetter.images.length + 1,
        originalFilename: '009-19470810-C01-01.jpg',
      },
    ],
  });
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

  test('shows the request id when transcript verification fails', async ({ page }) => {
    const mockedApi = await openMockLetterReviewWithOptions(
      page,
      createMockLetterReviewLetter(),
      {
        routeFailures: {
          verifyTranscript: {
            status: 503,
            error: 'Transcript verifier offline',
            requestId: 'req-review-transcript-503',
          },
        },
      },
    );

    const transcriptSection = page.locator('.editor-section').first();
    await transcriptSection.locator('.verify-btn').click();

    await expect(page.locator('.toast')).toContainText(
      'Transcript verifier offline (Request ID: req-review-transcript-503)',
    );
    await expect(transcriptSection.locator('.verify-btn')).toBeVisible();
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

  test('edits and verifies extra content through the review UI', async ({ page }) => {
    const initialLetter = createMockLetterWithExtras();
    const mockedApi = await openMockLetterReview(page, initialLetter);

    const extraSection = page.locator('.extra-content-section');
    const editor = extraSection.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('Envelope note from the cover.');

    await editor.fill('Corrected cover note for the review record.');

    await expect
      .poll(() => mockedApi.updateExtraContentRequests.length)
      .toBe(1);
    expect(mockedApi.updateExtraContentRequests).toEqual([
      {
        url: `${API_BASE_URL}/admin/letters/letter-review-1/extra-content`,
        body: { extraContent: 'Corrected cover note for the review record.' },
      },
    ]);

    await extraSection.locator('.verify-btn').click();

    await expect(page.locator('.toast:has-text("Extra content verified")')).toBeVisible();
    await expect(extraSection.locator('.verified-info')).toContainText('Verified');
    expect(mockedApi.verifyExtraContentRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/verify-extra-content`,
    ]);
  });

  test('clears extra content back to the empty state in the review UI', async ({ page }) => {
    const initialLetter = createMockLetterWithExtras({
      extraContentStatus: 'EDITED',
    });
    const mockedApi = await openMockLetterReview(page, initialLetter);

    const extraSection = page.locator('.extra-content-section');
    const editor = extraSection.locator('[contenteditable="true"]').first();
    await editor.fill('');

    await expect
      .poll(() => mockedApi.updateExtraContentRequests.length)
      .toBe(1);
    expect(mockedApi.updateExtraContentRequests[0]?.url).toBe(
      `${API_BASE_URL}/admin/letters/letter-review-1/extra-content`,
    );
    expect(
      mockedApi.updateExtraContentRequests[0]?.body.extraContent?.trim(),
    ).toBe('');
    await expect(extraSection.locator('.verify-btn')).toHaveCount(0);
    await expect(extraSection.locator('.verified-info')).toHaveCount(0);
  });

  test('shows the request id when extra content auto-save fails', async ({ page }) => {
    const initialLetter = createMockLetterWithExtras({
      extraContentStatus: 'EDITED',
    });
    const mockedApi = await openMockLetterReviewWithOptions(page, initialLetter, {
      routeFailures: {
        extraContent: {
          status: 503,
          error: 'Extra content save failed',
          requestId: 'req-extra-save-503',
        },
      },
    });

    const extraSection = page.locator('.extra-content-section');
    const editor = extraSection.locator('[contenteditable="true"]').first();
    await editor.fill('Cover note that fails to save.');

    await expect
      .poll(() => mockedApi.updateExtraContentRequests.length)
      .toBe(1);
    await expect(page.locator('.toast')).toContainText(
      'Extra content save failed (Request ID: req-extra-save-503)',
    );
    await expect(page.locator('.save-status.error')).toContainText('Save failed');
  });

  test('runs AI sync immediately from the countdown state', async ({ page }) => {
    const mockedApi = await openMockLetterReview(page);

    await page.locator('#sender').fill('Alicia Smith');
    const syncButton = page.locator('.metadata-section .sync-btn');
    await expect(syncButton).toContainText('3:00');

    await syncButton.click();

    await expect.poll(() => mockedApi.resyncCheckRequests.length).toBe(1);
    await expect.poll(() => mockedApi.resyncRequests.length).toBe(1);
    expect(mockedApi.resyncCheckRequests).toEqual([
      {
        url: `${API_BASE_URL}/admin/letters/letter-review-1/resync-check`,
        body: {
          oldSender: 'Alice Smith',
          newSender: 'Alicia Smith',
          oldRecipient: 'Bob Smith',
          newRecipient: 'Bob Smith',
        },
      },
    ]);
    expect(mockedApi.resyncRequests).toEqual([
      {
        url: `${API_BASE_URL}/admin/letters/letter-review-1/resync`,
        body: {
          oldSender: 'Alice Smith',
          newSender: 'Alicia Smith',
          oldRecipient: 'Bob Smith',
          newRecipient: 'Bob Smith',
        },
      },
    ]);
    await expect(page.locator('#hook')).toHaveValue('Synced metadata for Alicia Smith.');
    await expect(page.locator('#description')).toHaveValue(
      'Alicia Smith metadata synced for Bob Smith.',
    );
  });

  test('shows the request id when AI sync fails during the resync check', async ({
    page,
  }) => {
    const mockedApi = await openMockLetterReviewWithOptions(
      page,
      createMockLetterReviewLetter(),
      {
        routeFailures: {
          resyncCheck: {
            status: 500,
            error: 'Metadata sync check failed',
            requestId: 'req-review-sync-500',
          },
        },
      },
    );

    await page.locator('#sender').fill('Alicia Smith');
    await page.locator('.metadata-section .sync-btn').click();

    await expect(page.locator('.toast')).toContainText(
      'Metadata sync check failed (Request ID: req-review-sync-500)',
    );
    await expect
      .poll(() => mockedApi.resyncCheckRequests.length)
      .toBe(1);
    expect(mockedApi.resyncRequests).toHaveLength(0);
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
