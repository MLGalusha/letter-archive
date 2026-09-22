// Playwright CLI run-code callback. Install once in a dedicated browser session,
// then call page.capturePublicPerformance({ origin, route, scroll, ... }).
async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  let requests = new Map();
  cdp.on('Network.requestWillBeSent', e => requests.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp }));
  cdp.on('Network.loadingFinished', e => Object.assign(requests.get(e.requestId) ?? {}, { bytes: e.encodedDataLength, end: e.timestamp }));
  cdp.on('Network.loadingFailed', e => Object.assign(requests.get(e.requestId) ?? {}, { error: e.errorText }));
  await page.addInitScript(() => {
    Math.random = () => 0.25; // Freeze client-side highlight selection as well as API data.
    window.performanceAudit = { lcp: 0, ready: {}, waits: {}, samples: 0 };
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.performanceAudit.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    let previous = performance.now();
    setInterval(() => {
      const now = performance.now(), elapsed = now - previous;
      previous = now;
      const audit = window.performanceAudit;
      audit.samples++;
      for (const img of document.querySelectorAll('.cd-highlight-img .progressive-image__full, .preview-image__image')) {
        const rect = img.getBoundingClientRect();
        if (img.closest('[inert], [aria-hidden="true"]') || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
        if (img.parentElement.style.opacity === '0') continue;
        const key = img.getAttribute('src') || img.alt;
        const ready = img.complete && img.naturalWidth > 0;
        if (ready && !audit.ready[key]) audit.ready[key] = now;
        if (!ready) audit.waits[key] = (audit.waits[key] || 0) + elapsed;
      }
    }, 50);
  });
  page.capturePublicPerformance = async ({ origin, route = '/collections/003', scroll = false, swipe = false, interval = 350, steps = 10, reverse = false, width = 390, height = 844, dpr = 3, cpu = 4 }) => {
    await page.setViewportSize({ width, height });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: width < 640 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
    requests = new Map();
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const snapshot = async () => ({
      requests: [...requests.values()],
      page: await page.evaluate(() => ({ ...window.performanceAudit, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, cards: document.querySelectorAll('.letter-card').length })),
    });
    const initial = await snapshot();
    let swipeReadyMs;
    if (swipe) {
      const carousel = page.locator('.cd-highlights-col');
      const start = Date.now();
      await carousel.locator(':scope > .card-carousel-dots .card-carousel-dot').nth(1).click();
      await page.waitForFunction(() => {
        const img = document.querySelector('.cd-highlights-col > .card-carousel-frame > .card-carousel-viewport > .card-carousel-slide:nth-child(2) .progressive-image__full');
        return img?.complete && img.naturalWidth > 0;
      });
      swipeReadyMs = Date.now() - start;
    }
    if (scroll) {
      await page.evaluate(() => { window.performanceAudit.waits = {}; });
      for (let i = 0; i < steps; i++) {
        await page.evaluate(() => window.scrollBy({ top: 700, behavior: 'instant' }));
        await page.waitForTimeout(interval);
      }
      if (reverse) {
        for (let i = 0; i < steps; i++) {
          await page.evaluate(() => window.scrollBy({ top: -700, behavior: 'instant' }));
          await page.waitForTimeout(interval);
        }
      }
      await page.waitForTimeout(1500);
    }
    return { origin, route, scroll, swipe, interval, steps, reverse, swipeReadyMs, initial, final: await snapshot() };
  };
  return 'capture ready';
}
