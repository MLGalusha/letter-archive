/** #123 baseline: real built UI, real loopback routes; never runs against production.
 * node e2e/scripts/visible-image-local.mjs /absolute/fixture-output chromium|webkit label
 * Start the companion backend fixture first. One bounded workflow per invocation.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const [fixtureDirectory, engine = 'chromium', label = 'baseline'] = process.argv.slice(2);
assert.ok(fixtureDirectory && path.isAbsolute(fixtureDirectory));
assert.ok(['chromium', 'webkit'].includes(engine));
assert.match(label, /^[a-z0-9-]+$/);
const fixture = JSON.parse(await readFile(path.join(fixtureDirectory, 'fixture.json'), 'utf8'));
assert.match(fixture.base, /^https:\/\/127\.0\.0\.1:\d+$/);
assert.match(fixture.apiBase, /^https:\/\/127\.0\.0\.1:\d+$/);
const output = path.join(fixtureDirectory, `${label}-${engine}`);
await mkdir(output);
const browser = await ({ chromium, webkit })[engine].launch();
const requests = [], priorities = [], errors = [], searches = [];
const blockedFonts = [];
const bodyReads = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  const records = new Map();
  page.on('request', request => {
    const url = new URL(request.url());
    if (![fixture.base, fixture.apiBase].includes(url.origin)) {
      if (['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin)) blockedFonts.push({ url: request.url(), failure: null });
      else errors.push(`Unexpected nonlocal request attempted: ${url.origin}`);
      return;
    }
    if (url.origin !== fixture.apiBase) return;
    const row = { url: request.url(), method: request.method(), startedEpochMs: Date.now() };
    records.set(request, row); requests.push(row);
  });
  page.on('response', response => {
    const row = records.get(response.request());
    if (row) Object.assign(row, { status: response.status(), headers: response.headers() });
  });
  page.on('requestfinished', request => {
    const row = records.get(request);
    if (row) Object.assign(row, { finishedEpochMs: Date.now(), timing: request.timing() });
    if (row?.url.includes('/images/')) bodyReads.push((async () => {
      try {
        const body = await (await request.response()).body();
        row.bodyBytes = body.length; row.bodySha256 = createHash('sha256').update(body).digest('hex');
      } catch (error) { row.bodyReadError = String(error); }
    })());
  });
  page.on('requestfailed', request => {
    const row = records.get(request);
    if (row) Object.assign(row, { failedEpochMs: Date.now(), error: request.failure() });
    const blocked = blockedFonts.find(item => item.url === request.url() && item.failure === null);
    if (blocked) blocked.failure = request.failure();
  });
  if (engine === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', event => {
      if (event.type === 'Image' || event.request.url.includes('/letters/search')) priorities.push({
        event: 'request', id: event.requestId, url: event.request.url, timestamp: event.timestamp, priority: event.request.initialPriority,
      });
    });
    cdp.on('Network.resourceChangedPriority', event => priorities.push({ event: 'priority', ...event }));
    cdp.on('Network.responseReceived', event => {
      if (event.type === 'Image' || event.response.url.includes('/letters/search')) priorities.push({
        event: 'response', id: event.requestId, url: event.response.url, timestamp: event.timestamp,
        protocol: event.response.protocol, fromDiskCache: event.response.fromDiskCache, timing: event.response.timing,
      });
    });
  }
  await page.addInitScript(() => {
    const state = window.__visibleImageLedger = { phase: 'initial', cards: [], samples: [], inputs: [], searchApplied: false };
    const cards = new Map();
    let previous = performance.now();
    // Ignore telemetry without routing/intercepting image responses or disabling HTTP cache.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url ?? input, location.href);
      if (url.pathname.endsWith('/images/perf')) return Promise.resolve(new Response(null, { status: 204 }));
      return originalFetch(input, init);
    };
    navigator.sendBeacon = () => false;
    document.addEventListener('input', event => {
      if (event.target instanceof HTMLInputElement) {
        const at = performance.now();
        requestAnimationFrame(() => state.inputs.push({ value: event.target.value, at, frameAt: performance.now() }));
      }
    }, true);
    setInterval(() => {
      const now = performance.now(), elapsed = now - previous;
      const root = document.querySelector('#app-scroll')?.getBoundingClientRect();
      const header = document.querySelector('header')?.getBoundingClientRect();
      const top = Math.max(0, root?.top ?? 0, header && header.top <= 0 ? header.bottom : 0), bottom = Math.min(innerHeight, root?.bottom ?? innerHeight);
      let visible = 0, blank = 0;
      for (const container of document.querySelectorAll('.letter-card .preview-image')) {
        const img = container.querySelector('img');
        if (!img) continue;
        const rect = container.getBoundingClientRect();
        const inView = rect.width > 0 && rect.height > 0 && rect.bottom > top && rect.top < bottom && rect.right > 0 && rect.left < innerWidth;
        const source = img.getAttribute('src');
        let row = cards.get(container);
        if (!row) {
          row = { index: state.cards.length, href: container.closest('a')?.getAttribute('href'), firstSeen: now, admitted: null, firstVisible: null, ready: null, visibleWaitMs: 0, transitions: [] };
          cards.set(container, row); state.cards.push(row);
        }
        if (source && row.admitted === null) { row.admitted = now; row.url = new URL(source, location.href).href; }
        const style = getComputedStyle(img);
        const ready = Boolean(source && img.complete && img.naturalWidth > 0 && style.visibility !== 'hidden' && Number(style.opacity) >= .95);
        if (inView && row.firstVisible === null) row.firstVisible = now;
        if (ready && row.ready === null) row.ready = now;
        const transition = `${inView}/${ready}/${source}`;
        if (transition !== row.last) { row.transitions.push({ at: now, phase: state.phase, visible: inView, ready, source }); row.last = transition; }
        if (inView) { visible++; if (!ready) { blank++; row.visibleWaitMs += elapsed; } }
      }
      for (const [container, row] of cards) if (!container.isConnected && row.removedAt === undefined) {
        row.removedAt = now; row.removedPhase = state.searchApplied ? 'search' : state.phase;
      }
      state.samples.push({ at: now, phase: state.phase, visible, blank, elapsed, scrollY: document.querySelector('#app-scroll')?.scrollTop });
      previous = now;
    }, 50);
  });
  await page.goto(fixture.base, { waitUntil: 'domcontentloaded' });
  await page.locator('.archive-section .letter-card').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const root = document.querySelector('#app-scroll');
    root.scrollTop += document.querySelector('.archive-section .letter-card').getBoundingClientRect().top - 150;
  });
  for (const [phase, step, interval] of [['steady', 350, 700], ['fast', 700, 350]]) {
    await page.evaluate(value => { window.__visibleImageLedger.phase = value; }, phase);
    for (let n = 0; n < 8; n++) {
      await page.evaluate(amount => document.querySelector('#app-scroll').scrollBy({ top: amount, behavior: 'instant' }), step);
      await page.waitForTimeout(interval);
    }
  }
  // Start search while the final image burst may still be in progress.
  await page.evaluate(() => {
    window.__visibleImageLedger.phase = 'search';
    window.__visibleImageLedger.searchApplied = true;
    document.querySelector('#app-scroll').scrollTo({ top: 0, behavior: 'instant' });
  });
  const input = page.locator('.search:not(.search-compact) input[type="search"]');
  const started = Date.now(); // Action start includes Playwright dispatch/autowait, not just native input latency.
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/letters/search') && url.searchParams.get('search') === 'needle';
  }, { timeout: 15000 });
  await input.fill('needle');
  const response = await responsePromise;
  const result = await response.json();
  assert.equal(result.total, 6, 'Search must use the actual seeded transcript route');
  await page.waitForFunction(() => document.querySelectorAll('.archive-section .letter-card').length === 6);
  searches.push({ startedEpochMs: started, renderedEpochMs: Date.now(), total: result.total, input: await input.inputValue(), url: page.url() });
  await page.evaluate(() => { window.__visibleImageLedger.phase = 'settle'; });
  await page.waitForTimeout(5000);
  const ledger = await page.evaluate(() => ({ ...window.__visibleImageLedger,
    resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, timeOrigin: performance.timeOrigin,
  }));
  const seen = ledger.cards.filter(card => card.firstVisible !== null);
  const summary = {
    cardsSeen: seen.length,
    visibleWaitMs: seen.reduce((sum, card) => sum + card.visibleWaitMs, 0),
    completedFirstVisibleWaitMs: seen.filter(card => card.ready !== null).map(card => Math.max(0, card.ready - card.firstVisible)),
    searchRemovedUnresolved: seen.filter(card => card.ready === null && card.removedPhase === 'search').length,
    otherRemovedUnresolved: seen.filter(card => card.ready === null && card.removedAt !== undefined && card.removedPhase !== 'search').length,
    stillMountedUnresolved: seen.filter(card => card.ready === null && card.removedAt === undefined).length,
    lastSample: ledger.samples.at(-1),
  };
  await page.screenshot({ path: path.join(output, 'final.png') });
  await Promise.all(bodyReads);
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ fixture, engine, browserVersion: browser.version(), label, requests, priorities, searches, errors, blockedFonts, ledger, summary,
    limits: 'Local synthetic single workflow; geometric visibility clips scroll root/header but not arbitrary overlays. Readiness is not measured paint; 50ms sampling can assign the preceding interval to a newly visible card. Same fallback fonts under local-only CSP. Empty auxiliary settings. No network/CPU throttling. No browser-priority propagation into server FIFO. Fresh browser, shared server cache if rerun. searches.startedEpochMs precedes Playwright fill; action-to-results includes dispatch/autowait.' }, null, 2));
  console.log(JSON.stringify({ engine, cardsObserved: ledger.cards.length, requests: requests.length, searches, errors }));
} catch (error) {
  await Promise.all(bodyReads);
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), fixture, engine, label, requests, priorities, searches, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
