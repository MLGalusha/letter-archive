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
  test('shows the request id when the review page fails to load', async ({ page }) => {
    const initialLetter = createMockLetterReviewLetter();
    await installMockLetterReviewApi(page, {
      initialLetter,
      routeFailures: {
        loadLetter: {
          status: 503,
          error: 'Review record unavailable',
          requestId: 'req-review-load-503',
        },
      },
    });

    await page.goto(`/admin/letters/${initialLetter.id}`);

    await expect(page.locator('.review-content.loading-content')).toContainText(
      'Review record unavailable (Request ID: req-review-load-503)',
    );
  });

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
      expect.stringContaining('/mock-assets/collection-009/19470810/L01/009-19470810-L01-01.jpg'),
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
    const verifyBtn = transcriptSection.locator('.verify-btn');
    await verifyBtn.dispatchEvent('click');

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
    const verifyBtn2 = transcriptSection.locator('.verify-btn');
    await verifyBtn2.dispatchEvent('click');

    await expect(page.locator('.toast')).toContainText(
      'Transcript verifier offline (Request ID: req-review-transcript-503)',
    );
    await expect(transcriptSection.locator('.verify-btn')).toBeVisible();
    expect(mockedApi.verifyTranscriptRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/verify-transcript`,
    ]);
  });

  test('owns a coded source conflict from direct transcription until reload', async ({ page }) => {
    const mockedApi = await openMockLetterReviewWithOptions(
      page,
      createMockLetterReviewLetter(),
      {
        routeFailures: {
          transcribeLetter: {
            status: 409,
            error: 'Letter source changed while transcription was running',
            code: 'SOURCE_REVISION_CHANGED',
            requestId: 'req-transcribe-source-409',
          },
        },
      },
    );

    await page.locator('.editor-section').first().locator('.transcribe-btn').click();
    await page.locator('.regenerate-popup .btn-option', {
      hasText: 'Letter Transcript',
    }).click();

    const conflict = page.getByRole('alertdialog', {
      name: 'Letter source changed',
    });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText(
      'Letter source changed while transcription was running',
    );
    await expect(conflict.getByRole('button', {
      name: 'Reload latest source',
    })).toBeVisible();
    expect(mockedApi.transcribeLetterRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/transcribe-letter`,
      body: { primarySourceRevision: 4 },
    }]);
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
    const metaVerifyBtn = metadataSection.locator('.verify-btn');
    await metaVerifyBtn.dispatchEvent('click');

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
        body: {
          extraContent: 'Corrected cover note for the review record.',
          primarySourceRevision: 4,
        },
      },
    ]);

    const extraVerifyBtn = extraSection.locator('.verify-btn');
    await extraVerifyBtn.dispatchEvent('click');

    await expect(page.locator('.toast:has-text("Extra content verified")')).toBeVisible();
    await expect(extraSection.locator('.verified-info')).toContainText('Verified');
    expect(mockedApi.verifyExtraContentRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/verify-extra-content`,
    ]);
  });

  test('unlocks verified extra content through the shared review interaction', async ({ page }) => {
    const initialLetter = createMockLetterWithExtras({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: '2025-03-02T00:00:00.000Z',
    });
    const mockedApi = await openMockLetterReview(page, initialLetter);
    const extraSection = page.locator('.extra-content-section');
    const editor = extraSection.locator('.dynamic-editor');

    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await editor.dblclick();

    await expect(
      page.locator('.toast:has-text("Extra content verification removed")'),
    ).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    expect(mockedApi.unverifyExtraContentRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/unverify-extra-content`,
    ]);
  });

  test('keeps verified extra content locked after a source conflict', async ({ page }) => {
    const initialLetter = createMockLetterWithExtras({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: '2025-03-02T00:00:00.000Z',
    });
    const mockedApi = await openMockLetterReviewWithOptions(page, initialLetter, {
      routeFailures: {
        unverifyExtraContent: {
          status: 409,
          error: 'The letter source changed',
          code: 'SOURCE_REVISION_CHANGED',
          requestId: 'req-extra-source-409',
        },
      },
    });
    const extraSection = page.locator('.extra-content-section');
    const editor = extraSection.locator('.dynamic-editor');

    await editor.dblclick();

    await expect(
      page.getByRole('alertdialog', { name: 'Letter source changed' }),
    ).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    expect(mockedApi.unverifyExtraContentRequests).toHaveLength(1);
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

  test('shows the request id when metadata auto-save fails', async ({ page }) => {
    const mockedApi = await openMockLetterReviewWithOptions(
      page,
      createMockLetterReviewLetter(),
      {
        routeFailures: {
          updateLetter: {
            status: 503,
            error: 'Metadata save failed',
            requestId: 'req-metadata-save-503',
          },
        },
      },
    );

    await page.locator('#location').fill('Philadelphia, PA');

    await expect
      .poll(() => mockedApi.updateLetterRequests.length, { timeout: 10000 })
      .toBe(1);
    await expect(page.locator('.toast')).toContainText(
      'Metadata save failed (Request ID: req-metadata-save-503)',
    );
    await expect(page.locator('.save-status.error')).toContainText('Save failed');
    expect(mockedApi.versionRequests).toHaveLength(0);
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
