import type { Page, Route } from '@playwright/test';

export async function deferRoute(
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
