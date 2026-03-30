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
      `${API_BASE_URL}/admin/letters/pages/collection-009-page-1/detect-lines`,
    );
  });

  test('uses stored line segments before any redetect request is made', async ({
    page,
  }) => {
    const initialLetter = createLetterWithStoredLineSegments();
    const mockedApi = await openLineReview(page, initialLetter);

    await expect(page.locator('.line-review-progress')).toContainText('Line 1');
    await expect(page.locator('.line-review-editable')).toContainText('My dear mother,');
    expect(mockedApi.detectLineRequests).toHaveLength(0);

    await page.locator('.header-action.redetect').click({ force: true });
    await expect
      .poll(() => mockedApi.detectLineRequests.length)
      .toBe(1);
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

  test('shows debug layers and redetects the current page', async ({ page }) => {
    const mockedApi = await openLineReview(page);
    const initialDetectCount = mockedApi.detectLineRequests.length;

    await page.locator('.header-action.debug').click({ force: true });
    await expect(page.locator('.line-review-debug-legend')).toBeVisible();

    await page.locator('.header-action.redetect').click({ force: true });
    await expect
      .poll(() => mockedApi.detectLineRequests.length)
      .toBeGreaterThan(initialDetectCount);
  });

  test('falls back to browser-side line detection when detect-lines returns no geometry', async ({
    page,
  }) => {
    const detectLinesByPageId = createMockDetectLinesByPageId();
    Object.values(detectLinesByPageId).forEach((result) => {
      result.lineSegments = [];
      result.ocrWordBoxes = [];
    });

    const mockedApi = await openLineReview(
      page,
      createMockLetterReviewLetter(),
      { detectLinesByPageId },
    );

    await expect(page.locator('.line-review-progress')).toContainText('Line 1');
    await expect(page.locator('.line-review-editable')).toContainText('My dear mother,');
    expect(mockedApi.detectLineRequests).toContain(
      `${API_BASE_URL}/admin/letters/pages/collection-009-page-1/detect-lines`,
    );

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

  test('shows the request id when detect-lines fails and falls back locally', async ({
    page,
  }) => {
    const mockedApi = await openLineReview(page, createMockLetterReviewLetter(), {
      detectLinesFailuresByPageId: {
        'collection-009-page-1': {
          status: 503,
          error: 'Line detector offline',
          requestId: 'req-line-detect-503',
        },
      },
    });

    await expect(page.locator('.toast')).toContainText(
      'Line detector offline (Request ID: req-line-detect-503)',
    );
    await expect(page.locator('.line-review-progress')).toContainText('Line 1');
    expect(mockedApi.detectLineRequests).toContain(
      `${API_BASE_URL}/admin/letters/pages/collection-009-page-1/detect-lines`,
    );
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
