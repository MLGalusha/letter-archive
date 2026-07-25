import { createHash } from 'node:crypto';
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
    metadataJobStatus: 'FAILED',
    transcriptConfirmedAt: undefined,
    ...overrides,
  });
}

function digestTranscript(transcript: string) {
  return createHash('sha256').update(transcript, 'utf8').digest('hex');
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
  test('flushes autosaves before accepting one queued confirmation', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(page, initialLetter);
    const transcriptDraft = `${initialLetter.transcript.fullText}

Reviewed immediately before confirmation.`;
    const pendingSave = await deferRoute(
      page,
      /\/admin\/letters\/letter-review-1$/,
      (route) => route.request().method() === 'PUT',
    );
    const pendingConfirmation = await deferRoute(
      page,
      /\/confirm-transcript$/,
    );

    const transcriptEditor = page.locator('.transcript-editor').first();
    await transcriptEditor.fill(transcriptDraft);
    const liveTranscript = await transcriptEditor.innerText();
    await headerConfirm(page).click();
    const modal = confirmationModal(page);
    await expect(modal).toBeVisible();
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
      transcriptionText: liveTranscript,
      primarySourceRevision: 4,
    });
    const confirmationResponse = page.waitForResponse(
      /\/confirm-transcript$/,
    );
    pendingConfirmation.release();
    expect((await confirmationResponse).status()).toBe(202);

    await expect(page.locator('.toast')).toContainText(
      'Transcript confirmed; metadata extraction queued.',
    );
    await expect(page.locator('#sender')).toHaveValue('Alice Smith');
    await expect(page.locator('#recipient')).toHaveValue('Bob Smith');
    await expect(page.locator('#location')).toHaveValue('Boston');
    await expect(page.getByText('Confirmation Result Entity', {
      exact: true,
    })).toHaveCount(0);
    await expect(headerConfirm(page)).toHaveCount(0);
    await expect(metadataSection(page).getByRole('button', {
      name: 'Queued',
      exact: true,
    })).toBeDisabled();
    expect(mockedApi.confirmTranscriptRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/confirm-transcript`,
      body: {
        confirmedSender: 'Mabel Hart',
        confirmedRecipient: 'Theo Hart',
        primarySourceRevision: 4,
        transcriptDigest: digestTranscript(liveTranscript),
      },
    }]);
  });

  test('reconciles a receipt-only 202 with one authoritative GET', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
      { confirmTranscriptReceiptOnly: true },
    );
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

    await headerConfirm(page).click();
    await confirmationModal(page).getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Transcript confirmed; metadata extraction queued.',
    );
    await expect(headerConfirm(page)).toHaveCount(0);
    await expect(page.locator('#sender')).toHaveValue('Alice Smith');
    await expect(page.locator('#recipient')).toHaveValue('Bob Smith');
    await expect(page.locator('#location')).toHaveValue('Boston');
    await expect(metadataSection(page).getByRole('button', {
      name: 'Queued',
      exact: true,
    })).toBeDisabled();
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation + 1,
    );
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(1);
    expect(mockedApi.confirmTranscriptRequests[0]?.body.transcriptDigest)
      .toBe(digestTranscript(initialLetter.transcript.fullText));
  });

  test('blocks replay when an accepted receipt cannot hydrate its Letter', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
      {
        confirmTranscriptReceiptOnly: true,
        loadLetterFailureAfterConfirmationAttempt: {
          status: 503,
          error: 'Authoritative read unavailable',
          requestId: 'req-confirm-accepted-read-503',
        },
      },
    );
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

    await headerConfirm(page).click();
    await confirmationModal(page).getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Transcript confirmed, but the latest letter could not be loaded. '
      + 'Reload before continuing.',
    );
    await expect(headerConfirm(page)).toHaveCount(0);
    await expect(metadataSection(page).getByRole('button', {
      name: 'Generate',
      exact: true,
    })).toBeDisabled();
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(1);
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation + 1,
    );
  });

  test('drops a receipt disposition when a newer confirmation wins before GET', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
      {
        confirmTranscriptReceiptOnly: true,
        confirmationIdAfterReceipt: 'newer-confirmation-id',
      },
    );
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

    await headerConfirm(page).click();
    await confirmationModal(page).getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Transcript is confirmed; current metadata state refreshed.',
    );
    await expect(page.locator('.toast', {
      hasText: 'metadata extraction queued',
    })).toHaveCount(0);
    await expect(headerConfirm(page)).toHaveCount(0);
    await expect(metadataSection(page).getByRole('button', {
      name: 'Queued',
      exact: true,
    })).toBeDisabled();
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(1);
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation + 1,
    );
  });

  test('reconciles a precommit transport failure without replaying the POST', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
      { confirmTranscriptTransportAbort: true },
    );
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

    await headerConfirm(page).click();
    await confirmationModal(page).getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast', {
      hasText: 'Transcript confirmed',
    })).toHaveCount(0);
    await expect(headerConfirm(page)).toBeEnabled();
    await expect(metadataSection(page).getByRole('button', {
      name: 'Generate',
      exact: true,
    })).toBeEnabled();
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(1);
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation + 1,
    );
  });

  test('keeps a precommit 500 retryable after authoritative reconciliation', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
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
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

    await headerConfirm(page).click();
    const modal = confirmationModal(page);
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
      hasText: 'Transcript confirmed',
    })).toHaveCount(0);
    await expect(headerConfirm(page)).toBeEnabled();
    await expect(metadataSection(page).getByRole('button', {
      name: 'Generate',
      exact: true,
    })).toBeEnabled();
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation + 1,
    );
    expect(mockedApi.confirmTranscriptRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/confirm-transcript`,
      body: {
        primarySourceRevision: 4,
        transcriptDigest: digestTranscript(initialLetter.transcript.fullText),
      },
    }]);
  });

  test('reconciles a committed-after-500 result without replaying the POST', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
      {
        confirmTranscriptFailureAfterCommit: {
          status: 500,
          error: 'Confirmation response was lost after commit',
          requestId: 'req-confirm-committed-500',
        },
      },
    );
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

    await headerConfirm(page).click();
    const modal = confirmationModal(page);
    await modal.getByLabel('Sender').fill('Committed Sender');
    await modal.getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Transcript is confirmed; current metadata state refreshed.',
    );
    await expect(page.locator('.toast', {
      hasText: 'Confirmation response was lost after commit',
    })).toHaveCount(0);
    await expect(headerConfirm(page)).toHaveCount(0);
    await expect(page.locator('#sender')).toHaveValue('Alice Smith');
    await expect(page.locator('#recipient')).toHaveValue('Bob Smith');
    await expect(page.locator('#location')).toHaveValue('Boston');
    await expect(page.getByText('Confirmation Result Entity', {
      exact: true,
    })).toHaveCount(0);
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation + 1,
    );
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(1);
    expect(mockedApi.confirmTranscriptRequests[0]?.body).toEqual({
      confirmedSender: 'Committed Sender',
      confirmedRecipient: 'Bob Smith',
      primarySourceRevision: 4,
      transcriptDigest: digestTranscript(initialLetter.transcript.fullText),
    });
  });

  test('blocks replay when both a 500 outcome and its authoritative read fail', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
      {
        routeFailures: {
          confirmTranscript: {
            status: 500,
            error: 'Confirmation result unavailable',
            requestId: 'req-confirm-unknown-500',
          },
        },
        loadLetterFailureAfterConfirmationAttempt: {
          status: 503,
          error: 'Authoritative read unavailable',
          requestId: 'req-confirm-read-503',
        },
      },
    );
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

    await headerConfirm(page).click();
    await confirmationModal(page).getByRole('button', {
      name: 'Generate Metadata',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Transcript confirmation outcome is unknown. Refresh before retrying.',
    );
    await expect(headerConfirm(page)).toHaveCount(0);
    await expect(metadataSection(page).getByRole('button', {
      name: 'Generate',
      exact: true,
    })).toBeDisabled();
    expect(mockedApi.confirmTranscriptRequests).toHaveLength(1);
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation + 1,
    );
  });

  test('routes a coded source conflict to the terminal owner', async ({
    page,
  }) => {
    const initialLetter = createConfirmationReadyLetter();
    const mockedApi = await openConfirmationReview(
      page,
      initialLetter,
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
    const loadCountBeforeConfirmation = mockedApi.loadLetterRequests.length;

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
      hasText: 'Transcript confirmed',
    })).toHaveCount(0);
    expect(mockedApi.loadLetterRequests).toHaveLength(
      loadCountBeforeConfirmation,
    );
    expect(mockedApi.confirmTranscriptRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/confirm-transcript`,
      body: {
        confirmedSender: 'Conflict Sender',
        confirmedRecipient: 'Bob Smith',
        primarySourceRevision: 4,
        transcriptDigest: digestTranscript(initialLetter.transcript.fullText),
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
    expect((await response).status()).toBe(202);
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
      hasText: 'Transcript confirmed',
    })).toHaveCount(0);
    await expect(headerConfirm(page)).toBeEnabled();
    expect(firstApi.confirmTranscriptRequests).toHaveLength(1);
    expect(firstApi.confirmTranscriptRequests[0]?.body.transcriptDigest)
      .toBe(digestTranscript(firstLetter.transcript.fullText));
    expect(secondApi.confirmTranscriptRequests).toHaveLength(0);
  });
});
