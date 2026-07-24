import { expect, test, type Page } from "@playwright/test";
import { installMockProcessingQueueApi } from "./utils/mock-processing-queue-api";

async function openMockProcessingQueue(page: Page) {
  const mockedApi = await installMockProcessingQueueApi(page);
  await page.goto("/admin/processing");
  await page.locator(".proc-page").waitFor({ state: "visible" });
  await page.locator(".proc-card").first().waitFor({ state: "visible" });
  return mockedApi;
}

test.describe("@mocked Processing Queue", () => {
  test("shows an error banner when the durable snapshot fails to load", async ({
    page,
  }) => {
    await installMockProcessingQueueApi(page, {
      snapshotError: {
        message: "Queue backend unavailable",
        requestId: "req-queue-load-503",
      },
    });

    await page.goto("/admin/processing");
    await page.locator(".proc-page").waitFor({ state: "visible" });

    await expect(page.locator(".proc-error")).toContainText(
      "Queue backend unavailable",
    );
    await expect(page.locator(".proc-error")).toContainText(
      "req-queue-load-503",
    );
  });

  test("renders four durable stages, every active row, and removes queued metadata", async ({
    page,
  }) => {
    const mockedApi = await openMockProcessingQueue(page);

    const cards = page.locator(".proc-card");
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText("Transcription");
    await expect(cards.nth(1)).toContainText("Extra content transcription");
    await expect(cards.nth(2)).toContainText("Metadata extraction");
    await expect(cards.nth(3)).toContainText("Entity extraction");

    const transcriptionSection = page
      .locator(".proc-queue-section")
      .filter({
        has: page.getByText("Transcription queue", { exact: true }),
      });
    await expect(transcriptionSection.locator(".proc-active-row")).toHaveCount(
      2,
    );
    await expect(transcriptionSection).toContainText("August 10, 1947");
    await expect(transcriptionSection).toContainText("August 15, 1947");

    const extraSection = page
      .locator(".proc-queue-section")
      .filter({
        has: page.getByText("Extra content transcription queue", {
          exact: true,
        }),
      });
    await expect(extraSection).toContainText("1 shown");

    const metadataSection = page
      .locator(".proc-queue-section")
      .filter({
        has: page.getByText("Metadata extraction queue", { exact: true }),
      });
    await metadataSection.locator(".proc-queue-toggle").click();
    await expect(metadataSection).toContainText("August 12, 1947");

    await metadataSection.getByRole("button", { name: "Remove" }).click();

    await expect(metadataSection).toContainText("Queue is empty.");
    expect(mockedApi.removeRequests).toEqual([
      {
        letterId: "letter-3",
        type: "metadata",
        primarySourceRevision: 6,
        jobStateToken: "v1.queued-metadata-letter-3",
      },
    ]);
  });

  test("clear sends only the displayed snapshot and preserves unseen newer work", async ({
    page,
  }) => {
    const mockedApi = await openMockProcessingQueue(page);
    mockedApi.state.queued.extraContent.push({
      letterId: "letter-extra-new",
      primarySourceRevision: 10,
      jobStateToken: "v1.queued-extra-letter-new",
      letterTitle: "19470817",
      collectionCode: "009",
      sender: null,
      recipient: null,
      queuedAt: null,
    });
    page.on("dialog", (dialog) => dialog.accept());

    const extraSection = page
      .locator(".proc-queue-section")
      .filter({
        has: page.getByText("Extra content transcription queue", {
          exact: true,
        }),
    });
    await extraSection.getByRole("button", { name: "Clear queue" }).click();

    await expect.poll(() => mockedApi.clearRequests).toEqual([
      {
        type: "extra_content",
        items: [{
          letterId: "letter-extra",
          primarySourceRevision: 7,
          jobStateToken: "v1.queued-extra-letter-extra",
        }],
      },
    ]);
    expect(mockedApi.state.queued.extraContent.map(({ letterId }) => letterId))
      .toEqual(["letter-extra-new"]);
    await expect(page.locator(".toast-info")).toContainText(
      "Cleared 1 displayed queue item",
    );
  });

  test("shows the request id when durable cancellation fails", async ({
    page,
  }) => {
    const mockedApi = await installMockProcessingQueueApi(page, {
      cancelError: {
        message: "Job queue stalled",
        requestId: "req-queue-500",
      },
    });
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/admin/processing");
    await page.locator(".proc-card").first().waitFor({ state: "visible" });

    const transcriptionSection = page
      .locator(".proc-queue-section")
      .filter({
        has: page.getByText("Transcription queue", { exact: true }),
      });
    await transcriptionSection
      .getByRole("button", { name: "Cancel" })
      .first()
      .click();

    const toast = page.locator(".toast-error");
    await expect(toast).toContainText("Job queue stalled");
    await expect(toast).toContainText("req-queue-500");
    expect(mockedApi.cancelRequests).toEqual([
      {
        letterId: "letter-1",
        type: "transcription",
        primarySourceRevision: 3,
        jobStateToken: "v1.active-transcription-letter-1",
      },
    ]);
  });

  test("shows the request id when a durable retry fails", async ({ page }) => {
    const mockedApi = await installMockProcessingQueueApi(page, {
      retryError: {
        message: "Retry wake failed",
        requestId: "req-retry-503",
      },
    });

    await page.goto("/admin/processing");
    await page.locator(".proc-card").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Retry" }).click();

    const toast = page.locator(".toast-error");
    await expect(toast).toContainText("Retry wake failed");
    await expect(toast).toContainText("req-retry-503");
    expect(mockedApi.retryRequests).toEqual([
      {
        letterId: "letter-4",
        type: "metadata",
        primarySourceRevision: 9,
        jobStateToken: "v1.recent-metadata-letter-4",
      },
    ]);
  });

  test("does not claim a worker request when no managed worker is configured", async ({
    page,
  }) => {
    const mockedApi = await installMockProcessingQueueApi(page, {
      wakeResult: {
        requested: false,
        reason: "worker_not_configured",
      },
    });

    await page.goto("/admin/processing");
    await page.locator(".proc-card").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Wake worker" }).click();

    await expect(page.locator(".toast-info")).toContainText(
      "Managed worker is not configured here",
    );
    expect(mockedApi.wakeRequests).toHaveLength(1);
  });

  test("keeps the durable controls usable at a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openMockProcessingQueue(page);

    await expect(page.locator(".proc-card")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Wake worker" })).toBeVisible();
    await expect(page.getByText("Persisted observation only")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});
