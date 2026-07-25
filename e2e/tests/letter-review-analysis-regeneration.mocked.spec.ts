import {
  expect,
  test,
  type Page,
  type Route,
} from '@playwright/test';
import {
  createMockLetterReviewLetter,
  installMockLetterReviewApi,
} from './utils/mock-letter-review-api';
import { API_BASE_URL } from './utils/test-helpers';

const TRANSCRIPT_CONFIRMED_AT = '2025-03-01T00:00:00.000Z';

function metadataSection(page: Page) {
  return page.locator('.metadata-section');
}

function analysisRegenerationDialog(page: Page) {
  return page.getByRole('dialog', {
    name: 'Regenerate Analysis',
    exact: true,
  });
}

function entityExtractionJson(name: string) {
  return {
    people: [{
      name,
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
  };
}

function createAnalysisReadyLetter(
  overrides: Parameters<typeof createMockLetterReviewLetter>[0] = {},
) {
  return createMockLetterReviewLetter({
    transcriptConfirmedAt: TRANSCRIPT_CONFIRMED_AT,
    ...overrides,
  });
}

async function openAnalysisReview(
  page: Page,
  initialLetter = createAnalysisReadyLetter(),
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
    initialLetter.transcript.pages[0]?.text ?? initialLetter.transcript.fullText,
  );
  return mockedApi;
}

async function deferRoute(
  page: Page,
  pattern: RegExp,
  predicate: (route: Route) => boolean = () => true,
) {
  let markStarted!: () => void;
  let release!: () => void;
  let startedCount = 0;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(pattern, async (route) => {
    if (!predicate(route)) {
      await route.fallback();
      return;
    }
    startedCount += 1;
    markStarted();
    await responseGate;
    await route.fallback();
  });

  return {
    started,
    release,
    startedCount: () => startedCount,
  };
}

test.describe('@mocked Letter Review analysis regeneration', () => {
  test('keeps the analysis dialog semantic and contained on a phone viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAnalysisReview(page);

    const regenerateButton = metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    });
    await regenerateButton.click();
    let dialog = analysisRegenerationDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByLabel('Sender')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(regenerateButton).toBeFocused();

    await regenerateButton.click();
    dialog = analysisRegenerationDialog(page);
    await expect(dialog.getByLabel('Sender')).toBeFocused();

    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(16);
    expect(geometry.right).toBeLessThanOrEqual(390 - 16);
    expect(geometry.top).toBeGreaterThanOrEqual(16);
    expect(geometry.bottom).toBeLessThanOrEqual(844 - 16);
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(
      geometry.documentClientWidth,
    );

    const controls = [
      dialog.getByLabel('Sender'),
      dialog.getByLabel('Recipient'),
      dialog.getByRole('button', {
        name: 'Metadata Only',
        exact: true,
      }),
      dialog.getByRole('button', {
        name: 'Entities Only',
        exact: true,
      }),
      dialog.getByRole('button', {
        name: 'Both',
        exact: true,
      }),
      dialog.getByRole('button', {
        name: 'Cancel',
        exact: true,
      }),
    ];
    for (const control of controls) {
      await expect(control).toBeInViewport({ ratio: 1 });
      await control.click({ trial: true });
    }

    await page.setViewportSize({ width: 390, height: 500 });
    const shortViewport = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(shortViewport.left).toBeGreaterThanOrEqual(16);
    expect(shortViewport.right).toBeLessThanOrEqual(390 - 16);
    expect(shortViewport.top).toBeGreaterThanOrEqual(16);
    expect(shortViewport.bottom).toBeLessThanOrEqual(500 - 16);
    expect(shortViewport.scrollHeight).toBeGreaterThan(
      shortViewport.clientHeight,
    );
    expect(shortViewport.documentScrollWidth).toBeLessThanOrEqual(
      shortViewport.documentClientWidth,
    );

    await dialog.getByRole('button', {
      name: 'Cancel',
      exact: true,
    }).click({ trial: true });
    await expect(dialog.getByRole('button', {
      name: 'Cancel',
      exact: true,
    })).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      0,
    );
  });

  test('flushes metadata before Metadata Only and adopts returned analysis', async ({
    page,
  }) => {
    const mockedApi = await openAnalysisReview(page);
    const pendingSave = await deferRoute(
      page,
      /\/admin\/letters\/letter-review-1$/,
      (route) => route.request().method() === 'PUT',
    );
    const pendingRegeneration = await deferRoute(
      page,
      /\/regenerate-metadata$/,
    );
    const regenerateButton = metadataSection(page).locator(
      '.generate-btn',
    );

    await page.locator('#location').fill('Cambridge');
    await regenerateButton.click();
    const dialog = analysisRegenerationDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Sender').fill('Mabel Hart');
    await dialog.getByLabel('Recipient').fill('Theo Hart');
    await dialog.getByRole('button', {
      name: 'Metadata Only',
      exact: true,
    }).click();

    await pendingSave.started;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    expect(pendingRegeneration.startedCount()).toBe(0);
    expect(mockedApi.regenerateMetadataRequests).toHaveLength(0);

    const saveResponse = page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && new URL(response.url()).pathname
        === '/admin/letters/letter-review-1'
    ));
    pendingSave.release();
    await saveResponse;
    await pendingRegeneration.started;

    expect(mockedApi.updateLetterRequests[0]?.body).toMatchObject({
      locationWritten: 'Cambridge',
      primarySourceRevision: 4,
    });
    await expect.poll(() => mockedApi.versionRequests.length).toBe(1);
    await expect(metadataSection(page).getByRole('button', {
      name: 'Regenerating...',
      exact: true,
    })).toBeVisible();

    const regenerationResponse = page.waitForResponse(
      /\/regenerate-metadata$/,
    );
    pendingRegeneration.release();
    await regenerationResponse;
    await expect(page.locator('.toast')).toContainText(
      'Metadata regenerated',
    );
    await expect(page.locator('#sender')).toHaveValue('Mabel Hart');
    await expect(page.locator('#recipient')).toHaveValue('Theo Hart');
    await expect(page.locator('#location')).toHaveValue(
      'Regenerated Location',
    );
    await expect(page.locator('.entity-section')).toContainText(
      'Metadata Phase Entity',
    );
    await expect(regenerateButton).toBeFocused();
    expect(mockedApi.regenerateMetadataRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/regenerate-metadata`,
      body: {
        confirmedSender: 'Mabel Hart',
        confirmedRecipient: 'Theo Hart',
        primarySourceRevision: 4,
      },
    }]);
    expect(mockedApi.reExtractRequests).toHaveLength(0);
  });

  test('sends Entities Only corrections and adopts returned entities', async ({
    page,
  }) => {
    const initialLetter = createAnalysisReadyLetter({
      entityExtractionJson: entityExtractionJson('Existing Entity'),
    });
    const mockedApi = await openAnalysisReview(page, initialLetter);
    const pendingExtraction = await deferRoute(page, /\/re-extract$/);

    await metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    }).click();
    const dialog = analysisRegenerationDialog(page);
    await dialog.getByLabel('Sender').fill('Entity Candidate');
    await dialog.getByLabel('Recipient').fill('Entity Recipient');
    await dialog.getByRole('button', {
      name: 'Entities Only',
      exact: true,
    }).click();

    await pendingExtraction.started;
    await expect(page.locator('.entity-section').getByRole('button', {
      name: 'Regenerating...',
      exact: true,
    })).toBeVisible();

    const response = page.waitForResponse(/\/re-extract$/);
    pendingExtraction.release();
    await response;
    await expect(page.locator('.toast')).toContainText(
      'Entities re-extracted',
    );
    await expect(page.locator('.entity-section')).toContainText(
      'Entities Only Result',
    );
    expect(mockedApi.reExtractRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/re-extract`,
      body: {
        primarySourceRevision: 4,
        confirmedSender: 'Entity Candidate',
        confirmedRecipient: 'Entity Recipient',
        mode: 'entities_only',
      },
    }]);
    expect(mockedApi.regenerateMetadataRequests).toHaveLength(0);
  });

  test('owns a coded source conflict from the Both choice', async ({
    page,
  }) => {
    const mockedApi = await openAnalysisReview(
      page,
      createAnalysisReadyLetter(),
      {
        routeFailures: {
          reExtract: {
            status: 409,
            error: 'Letter source changed during full analysis',
            code: 'SOURCE_REVISION_CHANGED',
            requestId: 'req-analysis-source-409',
          },
        },
      },
    );

    await metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    }).click();
    const dialog = analysisRegenerationDialog(page);
    await dialog.getByLabel('Sender').fill('Full Sender');
    await dialog.getByLabel('Recipient').fill('Full Recipient');
    await dialog.getByRole('button', {
      name: 'Both',
      exact: true,
    }).click();

    const conflict = page.getByRole('alertdialog', {
      name: 'Letter source changed',
    });
    await expect(conflict).toBeVisible();
    await expect(conflict).toContainText(
      'Letter source changed during full analysis',
    );
    await expect(conflict).toContainText('req-analysis-source-409');
    await expect(conflict.getByRole('button', {
      name: 'Reload latest source',
    })).toBeFocused();
    await expect(page.locator('.toast', {
      hasText: 'Metadata re-extracted with corrections',
    })).toHaveCount(0);
    expect(mockedApi.reExtractRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/re-extract`,
      body: {
        primarySourceRevision: 4,
        confirmedSender: 'Full Sender',
        confirmedRecipient: 'Full Recipient',
        mode: 'full',
      },
    }]);
  });

  test('restores focus after an ordinary current-visit failure', async ({
    page,
  }) => {
    await openAnalysisReview(
      page,
      createAnalysisReadyLetter(),
      {
        routeFailures: {
          reExtract: {
            status: 500,
            error: 'Temporary analysis failure',
            requestId: 'req-analysis-500',
          },
        },
      },
    );
    const regenerateButton = metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    });

    await regenerateButton.click();
    await analysisRegenerationDialog(page).getByRole('button', {
      name: 'Both',
      exact: true,
    }).click();

    await expect(page.locator('.toast')).toContainText(
      'Temporary analysis failure',
    );
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(regenerateButton).toBeFocused();
  });

  test('rejects a delayed Both result after the review visit changes', async ({
    page,
  }) => {
    const firstLetter = createAnalysisReadyLetter({
      entityExtractionJson: entityExtractionJson('First Entity'),
    });
    const secondLetter = createAnalysisReadyLetter({
      id: 'letter-review-2',
      title: 'Review Letter Two',
      primarySourceRevision: 9,
      metadata: {
        sender: 'Second Sender',
        recipient: 'Second Recipient',
      },
      entityExtractionJson: entityExtractionJson('Second Entity'),
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
    const mockedApi = await openAnalysisReview(page, firstLetter);
    const pendingExtraction = await deferRoute(
      page,
      /\/letter-review-1\/re-extract$/,
    );

    await metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    }).click();
    const dialog = analysisRegenerationDialog(page);
    await dialog.getByLabel('Sender').fill('Stale First Sender');
    await dialog.getByRole('button', {
      name: 'Both',
      exact: true,
    }).click();
    await pendingExtraction.started;
    await expect(metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    })).toBeDisabled();

    await page.evaluate((letterId) => {
      window.history.pushState({}, '', `/admin/letters/${letterId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, secondLetter.id);
    await expect(page).toHaveURL(/\/admin\/letters\/letter-review-2$/);
    await expect(page.locator('#sender')).toHaveValue('Second Sender');
    await expect(page.locator('.entity-section')).toContainText(
      'Second Entity',
    );
    await expect(metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    })).toBeEnabled();
    await metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    }).click();
    const secondDialog = analysisRegenerationDialog(page);
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByLabel('Sender')).toBeFocused();

    const response = page.waitForResponse(
      /\/letter-review-1\/re-extract$/,
    );
    pendingExtraction.release();
    await response;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    await expect(page).toHaveURL(/\/admin\/letters\/letter-review-2$/);
    await expect(page.locator('#sender')).toHaveValue('Second Sender');
    await expect(page.locator('.entity-section')).toContainText(
      'Second Entity',
    );
    await expect(page.locator('.entity-section')).not.toContainText(
      'Full Analysis Result',
    );
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByLabel('Sender')).toBeFocused();
    await expect(page.locator('.toast', {
      hasText: 'Metadata re-extracted with corrections',
    })).toHaveCount(0);
    await expect(metadataSection(page).getByRole('button', {
      name: 'Regenerate',
      exact: true,
    })).toBeEnabled();
    expect(mockedApi.reExtractRequests).toEqual([{
      url: `${API_BASE_URL}/admin/letters/letter-review-1/re-extract`,
      body: {
        primarySourceRevision: 4,
        confirmedSender: 'Stale First Sender',
        confirmedRecipient: 'Bob Smith',
        mode: 'full',
      },
    }]);
  });
});
