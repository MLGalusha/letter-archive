import { expect, test, type Page } from '@playwright/test';
import {
  createMockLetterReviewLetter,
  installMockLetterReviewApi,
} from './utils/mock-letter-review-api';
import { API_BASE_URL } from './utils/test-helpers';

function transcriptionSection(page: Page) {
  return page.locator('.editor-section').filter({
    has: page.getByRole('heading', {
      name: 'Transcription',
      exact: true,
    }),
  });
}

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

function createMockPhotoLetter(
  overrides: Parameters<typeof createMockLetterReviewLetter>[0] = {},
) {
  const baseLetter = createMockLetterReviewLetter();
  return createMockLetterReviewLetter({
    transcriptStatus: 'EMPTY',
    metadataContentStatus: 'EMPTY',
    photoDescriptionStatus: 'EMPTY',
    photoDescription: '',
    ...overrides,
    images: overrides.images ?? [{
      ...baseLetter.images[0],
      id: 'collection-009-photo-1',
      type: 'photo',
      originalFilename: '009-19470810-P01-01.jpg',
    }],
    transcript: {
      pages: [],
      fullText: '',
      verified: false,
      ...(overrides.transcript ?? {}),
    },
  });
}

async function openMockPhotoReview(
  page: Page,
  initialLetter = createMockPhotoLetter(),
  options: Omit<Parameters<typeof installMockLetterReviewApi>[1], 'initialLetter'> = {},
) {
  const mockedApi = await installMockLetterReviewApi(page, {
    initialLetter,
    ...options,
  });
  await page.goto(`/admin/letters/${initialLetter.id}`);
  await page.locator('.letter-review-page').waitFor({ state: 'visible' });
  await page.locator('.viewer-image').waitFor({ state: 'visible' });
  await page.locator('.photo-description-section').waitFor({ state: 'visible' });
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

  test('opens replacement choices from a visible transcript draft', async ({
    page,
  }) => {
    const initialLetter = createMockLetterReviewLetter({
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EMPTY',
      transcript: {
        pages: [],
        fullText: '',
        verified: false,
      },
    });
    const mockedApi = await installMockLetterReviewApi(page, {
      initialLetter,
      routeFailures: {
        updateLetter: {
          status: 503,
          error: 'Keep the chooser test draft local',
        },
      },
    });
    await page.goto(`/admin/letters/${initialLetter.id}`);
    await page.locator('.letter-review-page').waitFor({ state: 'visible' });
    await page.locator('.viewer-image').waitFor({ state: 'visible' });

    const section = transcriptionSection(page);
    await section.locator('.transcript-editor').fill(
      'Visible local transcript draft',
    );
    await expect.poll(
      () => mockedApi.updateLetterRequests.length,
    ).toBe(1);
    const regenerate = section.getByRole('button', {
      name: 'Regenerate',
      exact: true,
    });
    await expect(regenerate).toBeVisible();
    await regenerate.click();

    const dialog = page.locator('.regenerate-popup');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toContainText(
      'This will overwrite the existing content.',
    );
    expect(mockedApi.transcribeLetterRequests).toHaveLength(0);

    await dialog.getByRole('button', {
      name: 'Cancel',
      exact: true,
    }).click();
    await expect(dialog).toHaveCount(0);
    expect(mockedApi.transcribeLetterRequests).toHaveLength(0);
  });

  test('clears the same transcript editor after an accepted empty result', async ({
    page,
  }) => {
    const initialLetter = createMockLetterReviewLetter();
    await openMockLetterReview(page, initialLetter);
    const editor = transcriptionSection(page).locator('.transcript-editor');
    const originalEditor = await editor.elementHandle();
    expect(originalEditor).not.toBeNull();

    const emptyLetter = createMockLetterReviewLetter({
      transcriptStatus: 'EMPTY',
      transcript: {
        pages: [],
        fullText: '',
        verified: false,
      },
    });
    await page.route(/\/transcribe-letter$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          letter: emptyLetter,
          transcribed: {
            pageCount: 0,
            textLength: 0,
          },
        }),
      });
    });

    await transcriptionSection(page).locator('.transcribe-btn').click();
    await page.locator('.regenerate-popup .btn-option', {
      hasText: 'Letter Transcript',
    }).click();

    await expect(page.locator('.toast')).toContainText('Letter transcribed');
    expect(await originalEditor!.evaluate((element) => element.isConnected))
      .toBe(true);
    await expect(editor).toHaveJSProperty('innerHTML', '');
  });

  test('resets Reading View generation, overlay, and split layout for a new visit', async ({
    page,
  }) => {
    const initialLetter = createMockLetterReviewLetter({
      primarySourceRevision: 3,
      readingText: undefined,
    });
    const secondLetter = createMockLetterReviewLetter({
      id: 'letter-review-2',
      title: 'Review Letter Two',
      primarySourceRevision: 7,
      readingText: undefined,
      transcript: {
        pages: [{
          pageNumber: 1,
          text: 'Second letter transcript with no reading view.',
        }],
        fullText: 'Second letter transcript with no reading view.',
        verified: false,
      },
    });
    await installMockLetterReviewApi(page, {
      initialLetter: secondLetter,
    });
    const mockedApi = await openMockLetterReview(page, initialLetter);
    const splitPane = page.locator('.review-layout.split-pane');
    const divider = page.locator(
      '.review-layout.split-pane > .split-pane-divider',
    );
    const overlay = page.locator('body > .reading-view-overlay');
    const readSplitPercent = () => splitPane.evaluate((element) => (
      (element as HTMLElement).style.getPropertyValue('--split-percent')
    ));
    const initialBodyOverflow = await page.evaluate(
      () => document.body.style.overflow,
    );

    await expect.poll(readSplitPercent).toBe('60%');
    const initialSplitPercent = await readSplitPercent();
    await expect(overlay).toHaveCount(0);
    await transcriptionSection(page).getByRole('button', {
      name: 'Reading view',
      exact: true,
    }).click();

    const dialog = page.getByRole('dialog', { name: 'Reading view' });
    await expect(dialog).toBeVisible();
    await expect(divider).toHaveClass(/(^|\s)locked(\s|$)/);
    await expect.poll(readSplitPercent).toBe('40%');
    await expect.poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe('hidden');

    await dialog.locator('.generate-reading-view-cta').click();

    await expect
      .poll(() => mockedApi.generateReadingViewRequests.length)
      .toBe(1);
    expect(mockedApi.generateReadingViewRequests[0]).toEqual({
      url: `${API_BASE_URL}/admin/letters/letter-review-1/generate-reading-view`,
      body: { primarySourceRevision: 3 },
    });
    await expect(dialog.locator('.reading-view-text')).toContainText(
      'I arrived safely in Boston. The weather has been kind.',
    );
    await expect(page.locator('.toast')).toContainText(
      'Reading view generated',
    );

    await page.evaluate((letterId) => {
      window.history.pushState({}, '', `/admin/letters/${letterId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, secondLetter.id);

    await expect(
      transcriptionSection(page).locator('.transcript-editor'),
    ).toContainText('Second letter transcript with no reading view.');
    await expect(overlay).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(divider).not.toHaveClass(/(^|\s)locked(\s|$)/);
    await expect.poll(readSplitPercent).toBe(initialSplitPercent);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe(initialBodyOverflow);

    await transcriptionSection(page).getByRole('button', {
      name: 'Reading view',
      exact: true,
    }).click();
    const secondDialog = page.getByRole('dialog', {
      name: 'Reading view',
    });
    await expect(secondDialog.locator('.reading-view-empty')).toContainText(
      'No reading view generated yet.',
    );
    await expect(secondDialog.locator('.reading-view-text')).toHaveCount(0);
    await expect(secondDialog).not.toContainText(
      'I arrived safely in Boston. The weather has been kind.',
    );

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    await expect(secondDialog).toHaveCount(0);
    await expect(divider).not.toHaveClass(/(^|\s)locked(\s|$)/);
    await expect.poll(readSplitPercent).toBe(initialSplitPercent);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe(initialBodyOverflow);
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

    await transcriptionSection(page).locator('.transcribe-btn').click();
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

  test('runs both transcription mutations in order against one source revision', async ({ page }) => {
    const mutationOrder: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.endsWith('/transcribe-letter')
        || pathname.endsWith('/transcribe-extras')
      ) {
        mutationOrder.push(pathname);
      }
    });
    const mockedApi = await openMockLetterReview(
      page,
      createMockLetterWithExtras(),
    );

    await transcriptionSection(page).locator('.transcribe-btn').click();
    await page.locator('.regenerate-popup .btn-option', {
      hasText: 'Both',
    }).click();

    await expect
      .poll(() => ({
        extras: mockedApi.transcribeExtrasRequests.length,
        letter: mockedApi.transcribeLetterRequests.length,
      }))
      .toEqual({ extras: 1, letter: 1 });
    expect(mutationOrder).toEqual([
      '/admin/letters/letter-review-1/transcribe-letter',
      '/admin/letters/letter-review-1/transcribe-extras',
    ]);
    expect(mockedApi.transcribeLetterRequests[0]?.body).toEqual({
      primarySourceRevision: 4,
    });
    expect(mockedApi.transcribeExtrasRequests[0]?.body).toEqual({
      primarySourceRevision: 4,
    });
    await expect(
      page.locator('.extra-content-section .dynamic-editor'),
    ).toContainText('AI-transcribed extra content.');
  });

  test('does not transcribe extras when the letter half of both fails', async ({ page }) => {
    const mockedApi = await openMockLetterReviewWithOptions(
      page,
      createMockLetterWithExtras(),
      {
        routeFailures: {
          transcribeLetter: {
            status: 503,
            error: 'Letter transcription unavailable',
            requestId: 'req-both-letter-503',
          },
        },
      },
    );

    await transcriptionSection(page).locator('.transcribe-btn').click();
    await page.locator('.regenerate-popup .btn-option', {
      hasText: 'Both',
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Letter transcription unavailable (Request ID: req-both-letter-503)',
    );
    expect(mockedApi.transcribeLetterRequests).toHaveLength(1);
    expect(mockedApi.transcribeExtrasRequests).toHaveLength(0);
  });

  test('does not continue both after its Letter Review visit becomes stale', async ({ page }) => {
    const initialLetter = createMockLetterWithExtras();
    const mockedApi = await openMockLetterReview(page, initialLetter);
    let markRequestStarted!: () => void;
    let releaseResponse!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    await page.route(/\/transcribe-letter$/, async (route) => {
      markRequestStarted();
      await responseGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          letter: initialLetter,
          transcribed: {
            pageCount: initialLetter.transcript.pages.length,
            textLength: initialLetter.transcript.fullText.length,
          },
        }),
      });
    });

    await transcriptionSection(page).locator('.transcribe-btn').click();
    await page.locator('.regenerate-popup .btn-option', {
      hasText: 'Both',
    }).click();
    await requestStarted;

    await page.getByRole('link', {
      name: 'Dashboard',
      exact: true,
    }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator('.letter-review-page')).toHaveCount(0);
    const response = page.waitForResponse(/\/transcribe-letter$/);
    releaseResponse();
    await response;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    expect(mockedApi.transcribeExtrasRequests).toHaveLength(0);
    await expect(page.locator('.toast', {
      hasText: 'Letter transcribed',
    })).toHaveCount(0);
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

  test('saves structured metadata before immediate verification', async ({
    page,
  }) => {
    const mutationOrder: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        (
          request.method() === 'PUT'
          && pathname.endsWith('/admin/letters/letter-review-1')
        )
        || pathname.endsWith('/verify-metadata')
      ) {
        mutationOrder.push(`${request.method()} ${pathname}`);
      }
    });
    const mockedApi = await openMockLetterReview(
      page,
      createMockLetterReviewLetter({
        metadata: {
          hook: '',
          primaryTopics: [],
        },
      }),
    );

    await page.locator('#date').fill('1932-07-07');
    await page.locator('#emotionalTone').selectOption('matter-of-fact');
    await page.locator('#relationship').selectOption('parent-child');
    await page.getByRole('button', { name: 'Add Topic' }).click();
    await page.getByText('family / marriage', { exact: true }).click();
    await page
      .locator('.metadata-section .verify-btn')
      .dispatchEvent('click');

    await expect(
      page.locator('.toast:has-text("Metadata verified")'),
    ).toBeVisible();
    expect(mockedApi.updateLetterRequests).toHaveLength(1);
    expect(mockedApi.updateLetterRequests[0]?.body).toMatchObject({
      primarySourceRevision: 4,
      extractedDate: '1932-07-07',
      emotionalTone: 'matter-of-fact',
      senderRecipientRelationship: 'parent-child',
      primaryTopics: ['family/marriage'],
    });
    expect(mockedApi.versionRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/versions`,
      body: {
        primarySourceRevision: 4,
        fieldType: 'metadata',
        content: {
          sender: 'Alice Smith',
          recipient: 'Bob Smith',
          extractedDate: '1932-07-07',
          locationWritten: 'Boston',
          hook: '',
          summary: 'Alice wrote to Bob after arriving safely in Boston.',
          emotionalTone: 'matter-of-fact',
          senderRecipientRelationship: 'parent-child',
          primaryTopics: ['family/marriage'],
        },
        source: 'human',
      },
    }]);
    expect(mutationOrder).toEqual([
      'PUT /admin/letters/letter-review-1',
      'POST /admin/letters/letter-review-1/verify-metadata',
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

  test('generates a photo description with saved AI context', async ({ page }) => {
    const mockedApi = await openMockPhotoReview(page);
    const photoSection = page.locator('.photo-description-section');

    await photoSection.getByRole('button', { name: 'Describe Photo' }).click();
    const modal = page.locator('.modal-content');
    await expect(modal.locator('.modal-title')).toHaveText('Describe Photo');
    await modal.getByLabel('AI Context').fill('Jimmy and Molly on the porch.');
    await modal.getByRole('button', { name: 'Describe Photo' }).click();

    await expect(photoSection.locator('.dynamic-editor')).toContainText(
      'A black-and-white family photograph taken on a front porch.',
    );
    await expect(photoSection.getByText('AI context saved')).toBeVisible();
    await expect(modal).toHaveCount(0);
    expect(mockedApi.describePhotoRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/describe-photo`,
      body: {
        photoDescriptionContext: 'Jimmy and Molly on the porch.',
        primarySourceRevision: 4,
      },
    }]);
  });

  test('edits, verifies, and unlocks a photo description', async ({ page }) => {
    const initialLetter = createMockPhotoLetter({
      photoDescriptionStatus: 'AI_DRAFT',
      photoDescription: 'Original photo description.',
    });
    const mockedApi = await openMockPhotoReview(page, initialLetter);
    const photoSection = page.locator('.photo-description-section');
    const editor = photoSection.locator('.dynamic-editor');

    await editor.fill('Corrected photo description.');
    await expect
      .poll(() => mockedApi.updatePhotoDescriptionRequests.length)
      .toBe(1);
    expect(mockedApi.updatePhotoDescriptionRequests[0]).toEqual({
      url: `${API_BASE_URL}/admin/letters/letter-review-1/photo-description`,
      body: {
        photoDescription: 'Corrected photo description.',
        primarySourceRevision: 4,
      },
    });

    await photoSection.getByRole('button', { name: 'Verify' }).click();
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await editor.dblclick();
    await expect(editor).toHaveAttribute('contenteditable', 'true');

    expect(mockedApi.verifyPhotoDescriptionRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/verify-photo-description`,
    ]);
    expect(mockedApi.unverifyPhotoDescriptionRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/unverify-photo-description`,
    ]);
  });

  test('keeps a verified photo description locked after a source conflict', async ({
    page,
  }) => {
    const initialLetter = createMockPhotoLetter({
      photoDescriptionStatus: 'VERIFIED',
      photoDescription: 'Verified photo description.',
      photoDescriptionVerifiedAt: '2025-03-04T00:00:00.000Z',
    });
    const mockedApi = await openMockPhotoReview(page, initialLetter, {
      routeFailures: {
        unverifyPhotoDescription: {
          status: 409,
          error: 'The photo source changed',
          code: 'SOURCE_REVISION_CHANGED',
          requestId: 'req-photo-source-409',
        },
      },
    });
    const editor = page.locator('.photo-description-section .dynamic-editor');

    await editor.dblclick();

    await expect(
      page.getByRole('alertdialog', { name: 'Letter source changed' }),
    ).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    expect(mockedApi.unverifyPhotoDescriptionRequests).toHaveLength(1);
  });

  test('edits and verifies extra content through the review UI', async ({ page }) => {
    const initialLetter = createMockLetterWithExtras();
    const mutationOrder: string[] = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.endsWith('/extra-content')
        || pathname.endsWith('/verify-extra-content')
      ) {
        mutationOrder.push(pathname);
      }
    });
    const mockedApi = await openMockLetterReview(page, initialLetter);

    const extraSection = page.locator('.extra-content-section');
    const editor = extraSection.locator('[contenteditable="true"]').first();
    await expect(editor).toContainText('Envelope note from the cover.');

    await editor.fill('Corrected cover note for the review record.');

    const extraVerifyBtn = extraSection.locator('.verify-btn');
    await extraVerifyBtn.dispatchEvent('click');

    await expect(page.locator('.toast:has-text("Extra content verified")')).toBeVisible();
    await expect(extraSection.locator('.verified-info')).toContainText('Verified');
    expect(mockedApi.updateExtraContentRequests).toEqual([
      {
        url: `${API_BASE_URL}/admin/letters/letter-review-1/extra-content`,
        body: {
          extraContent: 'Corrected cover note for the review record.',
          primarySourceRevision: 4,
        },
      },
    ]);
    expect(mockedApi.verifyExtraContentRequests).toEqual([
      `${API_BASE_URL}/admin/letters/letter-review-1/verify-extra-content`,
    ]);
    expect(mutationOrder).toEqual([
      '/admin/letters/letter-review-1/extra-content',
      '/admin/letters/letter-review-1/verify-extra-content',
    ]);
  });

  test('does not let an extra-content edit cancel a metadata edit', async ({ page }) => {
    const mockedApi = await openMockLetterReview(
      page,
      createMockLetterWithExtras(),
    );
    const extraEditor = page
      .locator('.extra-content-section [contenteditable="true"]')
      .first();

    await page.locator('#location').fill('Philadelphia, PA');
    await extraEditor.fill('A newly corrected envelope note.');

    await expect
      .poll(() => ({
        extra: mockedApi.updateExtraContentRequests.length,
        letter: mockedApi.updateLetterRequests.length,
      }))
      .toEqual({ extra: 1, letter: 1 });
    expect(mockedApi.updateLetterRequests[0]?.body).toMatchObject({
      locationWritten: 'Philadelphia, PA',
      primarySourceRevision: 4,
    });
    expect(mockedApi.updateExtraContentRequests[0]?.body).toMatchObject({
      extraContent: 'A newly corrected envelope note.',
      primarySourceRevision: 4,
    });
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

  test('keeps line review closed while newly unlocked extra content is being edited', async ({
    page,
  }) => {
    const initialLetter = createMockLetterWithExtras({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: '2025-03-02T00:00:00.000Z',
    });
    await openMockLetterReview(page, initialLetter);
    const editor = page.locator(
      '.extra-content-section .dynamic-editor',
    );

    await editor.dblclick();
    await expect(
      page.locator('.toast:has-text("Extra content verification removed")'),
    ).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'true');

    await page.locator('.viewer-image').click();

    await expect(page.locator('.viewer-image')).toBeVisible();
    await expect(page.locator('.line-review-mode')).toHaveCount(0);
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

  test('resolves a structured note through the shared mutation boundary', async ({ page }) => {
    const initialLetter = createMockLetterReviewLetter({
      aiNotes: [{
        id: 'note-review-date',
        content: 'Confirm the handwritten date.',
        category: 'date',
        priority: 'high',
        status: 'open',
        resolves_when: null,
        resolved_at: null,
        resolved_by: null,
        source: 'ai',
      }],
    });
    const mockedApi = await openMockLetterReview(page, initialLetter);
    const note = page.locator('.note-card', {
      hasText: 'Confirm the handwritten date.',
    });

    await note.getByRole('button', { name: 'Mark as resolved' }).click();

    await expect(note).toHaveClass(/resolved/);
    await expect(
      page.locator('.toast:has-text("Note resolved")'),
    ).toBeVisible();
    expect(mockedApi.noteStatusRequests).toEqual([{
      url:
        `${API_BASE_URL}/admin/letters/letter-review-1/notes/note-review-date`,
      noteId: 'note-review-date',
      body: {
        primarySourceRevision: 4,
        status: 'resolved',
      },
    }]);
  });
});
