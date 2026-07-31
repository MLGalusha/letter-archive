import { expect, test, type Page } from '@playwright/test';
import {
  createMockDetectLinesByPageId,
  createMockLetterReviewLetter,
  installMockLetterReviewApi,
} from './utils/mock-letter-review-api';
import { API_BASE_URL } from './utils/test-helpers';

async function openLineReview(
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
  await page.locator('.viewer-image').click();
  await page.locator('.line-review-mode').waitFor({ state: 'visible' });
  await page.locator('.line-review-input-overlay').waitFor({ state: 'visible' });
  return mockedApi;
}

function createLetterWithStoredLineSegments() {
  const initialLetter = createMockLetterReviewLetter();
  const detectLinesByPageId = createMockDetectLinesByPageId();

  return createMockLetterReviewLetter({
    images: initialLetter.images.map((image) => ({
      ...image,
      segmentTrustState: 'unverified',
      lineSegments: detectLinesByPageId[image.id]?.lineSegments ?? [],
    })),
  });
}

test.describe('@mocked Line Review', () => {
  test('enters review mode on collection 009 images and shows detected progress', async ({
    page,
  }) => {
    const mockedApi = await openLineReview(page);

    await expect(page.locator('.line-review-progress')).toContainText('Line 1');
    await expect(page.locator('.line-review-progress')).toContainText('Page 1 / 2');
    await expect(page.locator('.line-review-editable')).toContainText('My dear mother,');
    expect(mockedApi.detectLineRequests).toContain(
      `${API_BASE_URL}/admin/letters/pages/collection-009-page-1/line-segments`,
    );
  });

  test('navigates across lines and pages in review mode', async ({ page }) => {
    await openLineReview(page);

    await page.keyboard.press('Enter');
    await expect(page.locator('.line-review-editable')).toContainText(
      'I arrived safely in Boston.',
    );

    await page.keyboard.press('Enter');
    await expect(page.locator('.line-review-progress')).toContainText('Page 2 / 2');
    await expect(page.locator('.line-review-editable')).toContainText(
      'The weather has been kind.',
    );
  });

  test('keeps stored unverified segments on the split review until the image is clicked', async ({
    page,
  }) => {
    const initialLetter = createLetterWithStoredLineSegments();
    await installMockLetterReviewApi(page, { initialLetter });

    await page.goto(`/admin/letters/${initialLetter.id}`);
    await page.locator('.letter-review-page').waitFor({ state: 'visible' });

    await expect(page.locator('.viewer-image')).toBeVisible();
    await expect(page.locator('.transcript-editor')).toBeVisible();
    await expect(page.locator('.line-review-mode')).toHaveCount(0);

    await page.locator('.viewer-image').click();

    await expect(page.locator('.line-review-mode')).toBeVisible();
    await expect(page.locator('.line-review-input-overlay')).toBeVisible();
  });

  test('starts a fresh review shell when navigating to another letter', async ({
    page,
  }) => {
    const firstLetterBase = createMockLetterReviewLetter();
    const firstLetter = createMockLetterReviewLetter({
      images: firstLetterBase.images.map((image, index) => ({
        ...image,
        segmentTrustState: 'trusted',
        ...(index === 0
          ? {
              lineSegments: [{
                line: 1,
                bbox: [170, 210, 1480, 280],
                baseline: [[170, 274], [1480, 274]],
                ocrText: '',
                segmentClass: 'continuation',
              }],
            }
          : {}),
      })),
    });
    const secondLetterImage = createMockLetterReviewLetter().images[0];
    const secondLetter = createMockLetterReviewLetter({
      id: 'letter-review-2',
      title: 'Review Letter Two',
      metadata: {
        sender: 'Second Letter Sender',
      },
      images: [{
        ...secondLetterImage,
        id: 'letter-review-2-page-1',
        originalFilename: '009-19470811-L02-01.jpg',
      }],
      transcript: {
        pages: [{
          pageNumber: 1,
          text: 'Second letter transcript.',
        }],
        fullText: 'Second letter transcript.',
        verified: false,
      },
    });
    await installMockLetterReviewApi(page, {
      initialLetter: secondLetter,
    });
    await installMockLetterReviewApi(page, {
      initialLetter: firstLetter,
    });
    await page.goto(`/admin/letters/${firstLetter.id}`);
    await page.locator('.letter-review-page').waitFor({ state: 'visible' });
    await page.locator('.viewer-image').waitFor({ state: 'visible' });

    await page.locator('.overlay-center .nav-button').nth(1).click();
    await expect(page.locator('.image-counter')).toHaveText('2 / 2');
    await page.locator('.transcript-editor').selectText();
    const repairButton = page.getByRole('button', {
      name: 'Repair Text Location',
    });
    await expect(repairButton).toBeVisible();
    await repairButton.click();
    await expect(page.locator('.line-review-mode')).toBeVisible();
    await expect(page.locator('.line-review-repair-banner')).toContainText(
      'My dear mother,',
    );

    const secondLetterResponse = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url()
        === `${API_BASE_URL}/admin/letters/${secondLetter.id}`
    ));
    await page.evaluate((letterId) => {
      window.history.pushState({}, '', `/admin/letters/${letterId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, secondLetter.id);

    expect((await secondLetterResponse).ok()).toBe(true);
    await expect(page).toHaveURL(`/admin/letters/${secondLetter.id}`);
    await expect(page.locator('#sender')).toHaveValue(
      'Second Letter Sender',
    );
    await expect(page.locator('.line-review-mode')).toHaveCount(0);
    await expect(page.locator('.line-review-repair-banner')).toHaveCount(0);
    await expect(page.locator('.viewer-image')).toBeVisible();
    await expect(page.locator('.filename-value')).toHaveText(
      '009-19470811-L02-01.jpg',
    );
    await expect(page.locator('.overlay-center .nav-button')).toHaveCount(0);
    await expect(page.locator('.transcript-editor')).toContainText(
      'Second letter transcript.',
    );
  });

  test('keeps transcript review available when line-segments returns empty', async ({
    page,
  }) => {
    const detectLinesByPageId = createMockDetectLinesByPageId();
    Object.values(detectLinesByPageId).forEach((result) => {
      result.lineSegments = [];
    });

    await installMockLetterReviewApi(page, {
      initialLetter: createMockLetterReviewLetter(),
      detectLinesByPageId,
    });

    await page.goto(`/admin/letters/letter-review-1`);
    await page.locator('.letter-review-page').waitFor({ state: 'visible' });
    await page.locator('.viewer-image').waitFor({ state: 'visible' });
    await page.locator('.viewer-image').click();
    await page.locator('.line-review-mode').waitFor({ state: 'visible' });

    const unlocatedEditor = page.locator('.line-review-unlocated-editor');
    await expect(unlocatedEditor).toBeVisible();
    await expect(unlocatedEditor).toContainText('No detected location');
    await expect(unlocatedEditor.locator('.line-review-editable')).not.toBeEmpty();
    await expect(page.locator('.line-review-highlight-svg')).toHaveCount(0);
  });

  test('saves and approves only the current page geometry revision', async ({
    page,
  }) => {
    const initialLetter = createLetterWithStoredLineSegments();
    const mockedApi = await openLineReview(page, initialLetter);
    const currentPageId = initialLetter.images[0].id;
    const nextPageId = initialLetter.images[1].id;
    const initialGeometry =
      mockedApi.pageGeometryByPageId[currentPageId];
    const initialGeometryRevision = initialGeometry.geometryRevision;
    const initialProjectionChecksum =
      initialGeometry.lineSegmentsChecksumSha256;

    await page.getByRole('button', { name: 'Segments', exact: true }).click();
    await expect(page.locator('.seg-editor-actions')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Approve page' }),
    ).toBeVisible();

    await page.locator('.segment-editor-rect').first().dispatchEvent(
      'pointerdown',
      { pointerId: 1 },
    );
    await page.locator(
      '.segment-editor-toolbar-btn[data-hint="Delete (Del)"]',
    ).click();
    await page.getByRole('button', { name: 'Approve page' }).click();
    await expect
      .poll(() => mockedApi.pageSegmentTrustRequests.length)
      .toBe(1);
    await expect(page.getByText('Page approved', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();

    expect(mockedApi.saveLineSegmentRequests).toEqual([
      {
        url: `${API_BASE_URL}/admin/letters/pages/${currentPageId}/line-segments`,
        pageId: currentPageId,
        body: expect.objectContaining({
          lineSegments: expect.any(Array),
          primarySourceRevision: 4,
          sourceChecksum: initialLetter.images[0].sourceChecksum,
          expectedGeometryRevision: initialGeometryRevision,
          expectedLineSegmentsChecksumSha256:
            initialProjectionChecksum,
        }),
      },
    ]);
    const savedGeometry = mockedApi.pageGeometryByPageId[currentPageId];
    expect(savedGeometry.geometryRevision).toBe(initialGeometryRevision + 1);
    expect(mockedApi.pageSegmentTrustRequests[0]).toEqual({
      url: `${API_BASE_URL}/admin/letters/pages/${currentPageId}/segment-trust`,
      pageId: currentPageId,
      body: {
        trustState: 'trusted',
        primarySourceRevision: 4,
        sourceChecksum: initialLetter.images[0].sourceChecksum,
        expectedGeometryRevision: savedGeometry.geometryRevision,
        expectedGeometryChecksumSha256:
          savedGeometry.geometryChecksumSha256,
      },
    });
    expect(mockedApi.letterSegmentTrustRequests).toHaveLength(0);
    expect(savedGeometry.reviewState).toEqual(expect.objectContaining({
      trustState: 'trusted',
      approvedGeometryRevision: savedGeometry.geometryRevision,
      approvedGeometryChecksumSha256:
        savedGeometry.geometryChecksumSha256,
    }));
    expect(
      mockedApi.pageGeometryByPageId[nextPageId].reviewState.trustState,
    ).toBe('unverified');

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(
      page.getByRole('button', { name: 'Approve page' }),
    ).toBeVisible();
    await expect(page.getByText('Page approved', { exact: true })).toHaveCount(0);
  });

  test('saves edited transcript text and records a transcript version on exit', async ({
    page,
  }) => {
    const mockedApi = await openLineReview(page);

    const editable = page.locator('.line-review-editable');
    await editable.click();
    await editable.evaluate((node, value) => {
      node.textContent = value;
      node.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: value,
        }),
      );
    }, 'My dearest mother,');

    await page.locator('.line-review-close-btn').click();

    await expect(page.locator('.transcript-editor')).toContainText('My dearest mother,');
    await expect
      .poll(() => mockedApi.updateLetterRequests.length)
      .toBe(1);
    await expect
      .poll(() => mockedApi.versionRequests.length)
      .toBe(1);

    expect(mockedApi.updateLetterRequests[0]).toEqual({
      url: `${API_BASE_URL}/admin/letters/letter-review-1`,
      body: expect.objectContaining({
        transcriptionText: expect.stringContaining('My dearest mother,'),
      }),
    });
    expect(mockedApi.versionRequests[0]).toEqual({
      url: `${API_BASE_URL}/admin/letters/letter-review-1/versions`,
      body: expect.objectContaining({
        fieldType: 'transcript',
        source: 'human',
      }),
    });
  });

  test('clears transcript verification after a line-review edit is saved', async ({
    page,
  }) => {
    const initialLetter = createMockLetterReviewLetter({
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: '2025-03-01T00:00:00.000Z',
      transcript: {
        verified: true,
      },
    });
    const mockedApi = await openLineReview(page, initialLetter);

    const editable = page.locator('.line-review-editable');
    await editable.click();
    await editable.evaluate((node, value) => {
      node.textContent = value;
      node.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: value,
        }),
      );
    }, 'My dearest mother,');

    await page.locator('.line-review-close-btn').click();

    const transcriptSection = page.locator('.editor-section').first();
    await expect(transcriptSection.locator('.verified-info')).toHaveCount(0);
    await expect(transcriptSection.locator('.verify-btn')).toBeVisible();
    await expect(transcriptSection.locator('.transcript-editor')).toHaveAttribute(
      'contenteditable',
      'true',
    );
    await expect
      .poll(() => mockedApi.updateLetterRequests.length)
      .toBe(1);
  });

  test('shows error toast when loading line segments fails', async ({
    page,
  }) => {
    await installMockLetterReviewApi(page, {
      initialLetter: createMockLetterReviewLetter(),
      detectLinesFailuresByPageId: {
        'collection-009-page-1': {
          status: 503,
          error: 'Database offline',
          requestId: 'req-segments-503',
        },
      },
    });

    await page.goto(`/admin/letters/letter-review-1`);
    await page.locator('.letter-review-page').waitFor({ state: 'visible' });
    await page.locator('.viewer-image').waitFor({ state: 'visible' });
    await page.locator('.viewer-image').click();
    await page.locator('.line-review-mode').waitFor({ state: 'visible' });

    await expect(page.locator('.toast')).toContainText('Database offline (Request ID: req-segments-503)');
  });

  test('shows the request id when transcript auto-save fails on exit', async ({
    page,
  }) => {
    const mockedApi = await openLineReview(page, createMockLetterReviewLetter(), {
      routeFailures: {
        updateLetter: {
          status: 503,
          error: 'Transcript save failed',
          requestId: 'req-transcript-save-503',
        },
      },
    });

    const editable = page.locator('.line-review-editable');
    await editable.click();
    await editable.evaluate((node, value) => {
      node.textContent = value;
      node.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: value,
        }),
      );
    }, 'My dearest mother,');

    await page.locator('.line-review-close-btn').click();

    await expect(page.locator('.toast-error').filter({ hasText: 'Transcript save failed' })).toContainText(
      'Transcript save failed (Request ID: req-transcript-save-503)',
    );
    await expect(page.locator('.save-status.error')).toContainText('Save failed');
    await expect
      .poll(() => mockedApi.updateLetterRequests.length)
      .toBe(1);
    expect(mockedApi.versionRequests).toHaveLength(0);
  });
});
