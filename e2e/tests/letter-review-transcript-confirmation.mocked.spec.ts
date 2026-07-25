import {
  expect,
  test,
  type Page,
} from '@playwright/test';
import {
  createMockLetterReviewLetter,
  installMockLetterReviewApi,
} from './utils/mock-letter-review-api';
import { deferRoute } from './utils/deferred-route';
import { API_BASE_URL } from './utils/test-helpers';

function metadataSection(page: Page) {
  return page.locator('.metadata-section');
}

function headerConfirm(page: Page) {
  return page.locator('[data-tooltip="Confirm Transcript"]');
}

function confirmationModal(page: Page) {
  return page.locator('.modal-content').filter({
    has: page.getByRole('heading', {
      name: 'Generate Metadata',
      exact: true,
    }),
  });
}

function createConfirmationReadyLetter(
  overrides: Parameters<typeof createMockLetterReviewLetter>[0] = {},
) {
  return createMockLetterReviewLetter({
    metadataContentStatus: 'EMPTY',
    transcriptConfirmedAt: undefined,
    ...overrides,
  });
}

async function openConfirmationReview(
  page: Page,
  initialLetter = createConfirmationReadyLetter(),
  options: Omit<
    Parameters<typeof installMockLetterReviewApi>[1],
    'initialLetter'
  > = {},
) {
  const mockedApi = await installMockLetterReviewApi(page, {
    initialLetter,
    ...options,
  });
  await page.goto(`/admin/letters/${initialLetter.id}`);
  await page.locator('.letter-review-page').waitFor({ state: 'visible' });
  await page.locator('.viewer-image').waitFor({ state: 'visible' });
  await expect(page.locator('.transcript-editor').first()).toContainText(
    initialLetter.transcript.pages[0]?.text
      ?? initialLetter.transcript.fullText,
  );
  return mockedApi;
}

test.describe('@mocked Letter Review transcript confirmation', () => {
  test('flushes autosaves before confirmation and adopts the returned DTO', async ({
    page,
  }) => {
    const mockedApi = await openConfirmationReview(page);
    const pendingSave = await deferRoute(
      page,
      /\/admin\/letters\/letter-review-1$/,
      (route) => route.request().method() === 'PUT',
    );
    const pendingConfirmation = await deferRoute(
      page,
      /\/confirm-transcript$/,
    );

    await page.locator('#location').fill('Unsaved Cambridge');
    await headerConfirm(page).click();
    const modal = confirmationModal(page);
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel('Sender')).toHaveValue('Alice Smith');
    await expect(modal.getByLabel('Recipient')).toHaveValue('Bob Smith');
    await modal.getByLabel('Sender').fill('Mabel Hart');
    await modal.getByLabel('Recipient').fill('Theo Hart');
    await modal.getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();
    await expect(modal).toBeHidden();

    await pendingSave.started;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    expect(pendingConfirmation.startedCount()).toBe(0);
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(0);

    const saveResponse = page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && new URL(response.url()).pathname
        === '/admin/letters/letter-review-1'
    ));
    pendingSave.release();
    await saveResponse;
    await pendingConfirmation.started;

    expect(mockedApi.updateLetterRequests[0]?.body).toMatchObject({
      locationWritten: 'Unsaved Cambridge',
      primarySourceRevision: 4,
    });
    const confirmationResponse = page.waitForResponse(
      /\/confirm-transcript$/,
    );
    pendingConfirmation.release();
    await confirmationResponse;

    await expect(page.locator('.toast')).toContainText(
      'Transcript confirmed — metadata extracted',
    );
    await expect(page.locator('#sender')).toHaveValue('Mabel Hart');
    await expect(page.locator('#recipient')).toHaveValue('Theo Hart');
    await expect(page.locator('#location')).toHaveValue(
      'Confirmed Response Location',
    );
    await expect(page.locator('.entity-section')).toContainText(
      'Confirmation Result Entity',
    );
    await expect(page.getByText('Metadata Ready', { exact: true }))
      .toBeVisible();
    await expect(headerConfirm(page)).toHaveCount(0);
    await expect(metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    })).toBeVisible();
    expect(mockedApi.confirmTranscriptRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/confirm-transcript`,
      body: {
        confirmedSender: 'Mabel Hart',
        confirmedRecipient: 'Theo Hart',
        primarySourceRevision: 4,
      },
    }]);
  });

  test('shares one fresh draft across both triggers and reports ordinary failure', async ({
    page,
  }) => {
    const mockedApi = await openConfirmationReview(
      page,
      createConfirmationReadyLetter(),
      {
        routeFailures: {
          confirmTranscript: {
            status: 500,
            error: 'Temporary confirmation failure',
            requestId: 'req-confirm-500',
          },
        },
      },
    );

    await headerConfirm(page).click();
    let modal = confirmationModal(page);
    await modal.getByLabel('Sender').fill('Discarded Draft');
    await modal.getByRole('button', {
      name: 'Cancel',
      exact: true,
    }).click();
    await expect(modal).toBeHidden();
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(0);

    await metadataSection(page).getByRole('button', {
      name: 'Generate',
      exact: true,
    }).click();
    modal = confirmationModal(page);
    await expect(modal.getByLabel('Sender')).toHaveValue('Alice Smith');
    await expect(modal.getByLabel('Recipient')).toHaveValue('Bob Smith');
    await modal.getByLabel('Sender').fill('');
    await modal.getByLabel('Recipient').fill('');
    await modal.getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Temporary confirmation failure (Request ID: req-confirm-500)',
    );
    await expect(page.locator('.toast', {
      hasText: 'Transcript confirmed — metadata extracted',
    })).toHaveCount(0);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(headerConfirm(page)).toBeEnabled();
    expect(mockedApi.confirmTranscriptRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/confirm-transcript`,
      body: {
        primarySourceRevision: 4,
      },
    }]);
  });

  test('routes a coded source conflict to the terminal owner', async ({
    page,
  }) => {
    const mockedApi = await openConfirmationReview(
      page,
      createConfirmationReadyLetter(),
      {
        routeFailures: {
          confirmTranscript: {
            status: 409,
            error: 'Letter source changed during confirmation',
            code: 'SOURCE_REVISION_CHANGED',
            requestId: 'req-confirm-source-409',
          },
        },
      },
    );

    await headerConfirm(page).click();
    const modal = confirmationModal(page);
    await modal.getByLabel('Sender').fill('Conflict Sender');
    await modal.getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    const conflict = page.getByRole('alertdialog', {
      name: 'Letter source changed',
    });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText(
      'Letter source changed during confirmation',
    );
    await expect(conflict).toContainText('req-confirm-source-409');
    await expect(conflict.getByRole('button', {
      name: 'Reload latest source',
    })).toBeFocused();
    await expect(page.locator('.toast', {
      hasText: 'Transcript confirmed — metadata extracted',
    })).toHaveCount(0);
    expect(mockedApi.confirmTranscriptRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/confirm-transcript`,
      body: {
        confirmedSender: 'Conflict Sender',
        confirmedRecipient: 'Bob Smith',
        primarySourceRevision: 4,
      },
    }]);
  });

  test('rejects a delayed first-A response without disturbing B', async ({
    page,
  }) => {
    const firstLetter = createConfirmationReadyLetter();
    const secondLetter = createConfirmationReadyLetter({
      id: 'letter-review-2',
      title: 'Review Letter Two',
      primarySourceRevision: 9,
      metadata: {
        sender: 'Second Sender',
        recipient: 'Second Recipient',
      },
      entityExtractionJson: {
        people: [{
          name: 'Second Entity',
          aliases: [],
          role: 'mentioned',
          relationship_to_sender: null,
          details: [],
          emotional_significance: null,
          quotes: [],
          confidence: 0.96,
        }],
        places: [],
        relationships: [],
        person_place_connections: [],
      },
      transcript: {
        pages: [{
          pageNumber: 1,
          text: 'Second letter transcript.',
        }],
        fullText: 'Second letter transcript.',
        verified: false,
      },
    });
    const secondApi = await installMockLetterReviewApi(page, {
      initialLetter: secondLetter,
    });
    const firstApi = await openConfirmationReview(page, firstLetter);
    const pendingConfirmation = await deferRoute(
      page,
      /\/letter-review-1\/confirm-transcript$/,
    );

    await headerConfirm(page).click();
    await confirmationModal(page).getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();
    await pendingConfirmation.started;
    await expect(headerConfirm(page)).toBeDisabled();

    await page.evaluate((letterId) => {
      window.history.pushState({}, '', `/admin/letters/${letterId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, secondLetter.id);
    await expect(page).toHaveURL(/\/admin\/letters\/letter-review-2$/);
    await expect(page.locator('#sender')).toHaveValue('Second Sender');
    await expect(page.locator('.entity-section')).toContainText(
      'Second Entity',
    );
    await expect(headerConfirm(page)).toBeEnabled();

    await headerConfirm(page).click();
    const secondModal = confirmationModal(page);
    await secondModal.getByLabel('Sender').fill('Second Modal Draft');
    await expect(secondModal.getByLabel('Sender')).toBeFocused();

    const response = page.waitForResponse(
      /\/letter-review-1\/confirm-transcript$/,
    );
    pendingConfirmation.release();
    await response;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    await expect(page).toHaveURL(/\/admin\/letters\/letter-review-2$/);
    await expect(page.locator('#sender')).toHaveValue('Second Sender');
    await expect(page.locator('.entity-section')).toContainText(
      'Second Entity',
    );
    await expect(secondModal).toBeVisible();
    await expect(secondModal.getByLabel('Sender')).toHaveValue(
      'Second Modal Draft',
    );
    await expect(secondModal.getByLabel('Sender')).toBeFocused();
    await expect(page.locator('.toast', {
      hasText: 'Transcript confirmed — metadata extracted',
    })).toHaveCount(0);
    await expect(headerConfirm(page)).toBeEnabled();
    expect(firstApi.confirmTranscriptRequests).toHaveLength(1);
    expect(secondApi.confirmTranscriptRequests).toHaveLength(0);
  });
});
