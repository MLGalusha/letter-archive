import { expect, test, type Page } from '@playwright/test';
import {
  createMockLetterReviewLetter,
  installMockLetterReviewApi,
} from './utils/mock-letter-review-api';
import { API_BASE_URL } from './utils/test-helpers';

async function openLineReview(
  page: Page,
  initialLetter = createMockLetterReviewLetter(),
) {
  const mockedApi = await installMockLetterReviewApi(page, { initialLetter });
  await page.goto(`/admin/letters/${initialLetter.id}`);
  await page.locator('.letter-review-page').waitFor({ state: 'visible' });
  await page.locator('.header-action.review').click();
  await page.locator('.line-review-mode').waitFor({ state: 'visible' });
  await page.locator('.line-review-input-overlay').waitFor({ state: 'visible' });
  return mockedApi;
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

    await page.locator('.header-action.debug').click();
    await expect(page.locator('.line-review-debug-legend')).toBeVisible();

    await page.locator('.header-action.redetect').click();
    await expect
      .poll(() => mockedApi.detectLineRequests.length)
      .toBeGreaterThan(initialDetectCount);
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

    await page.locator('.header-action.review').click();

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

  test('deletes and restores a detected line through correction requests', async ({
    page,
  }) => {
    const mockedApi = await openLineReview(page);

    const overlay = page.locator('.line-review-input-overlay');
    const deleteButton = page.locator('.line-review-delete-btn');

    await deleteButton.click();
    await expect(overlay).toHaveClass(/line-review-input-deleted/);
    expect(mockedApi.lineCorrectionRequests[0]).toEqual({
      url: `${API_BASE_URL}/admin/letters/pages/collection-009-page-1/line-corrections`,
      body: expect.objectContaining({
        correctionType: 'delete',
        sourceSegmentIds: [101],
      }),
    });

    await deleteButton.click();
    await expect(overlay).not.toHaveClass(/line-review-input-deleted/);
    expect(mockedApi.lineCorrectionRequests[1]).toEqual({
      url: `${API_BASE_URL}/admin/letters/pages/collection-009-page-1/line-corrections`,
      body: expect.objectContaining({
        correctionType: 'undelete',
        sourceSegmentIds: [101],
      }),
    });
  });
});
