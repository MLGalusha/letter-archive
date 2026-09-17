import { expect, test, type Page } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

async function openFixture(page: Page) {
  page.on("pageerror", error => console.log("Admin fixture error:", error.message));
  page.on("console", message => { if (message.type() === "error") console.log(message.text()); });
  await page.addInitScript(() => {
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    (window as any).setVisibility = (value: DocumentVisibilityState) => { visibility = value; document.dispatchEvent(new Event('visibilitychange')); };
    (window as any).streams = [];
    (window as any).EventSource = class {
      listeners = new Map<string, Function[]>(); onerror: Function | null = null; closed = false;
      constructor() { (window as any).streams.push(this); }
      addEventListener(type: string, callback: Function) { this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]); }
      close() { this.closed = true; }
      emit(type: string, data = {}) { for (const callback of this.listeners.get(type) ?? []) callback({ data: JSON.stringify(data) }); }
    };
  });
  await page.route('**/__admin-poll-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <div id="fixture"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const sidebarSource=await (await fetch('/src/components/AdminSidebar/AdminSidebar.tsx')).text();
      const routerUrl=sidebarSource.match(/from ["']([^"']*react-router-dom[^"']*)["']/)[1];
      const {MemoryRouter}=await import(routerUrl);
      const {useProcessingState}=await import('/src/hooks/useProcessingState.ts');
      const {default:AdminSidebar}=await import('/src/components/AdminSidebar/AdminSidebar.tsx');
      function Queue() {const state=useProcessingState(); return React.createElement('div',{style:{marginLeft:320,padding:24}},
        React.createElement('output',null,state.loading?'Queue loading':'Queue ready'),
        React.createElement('button',{onClick:()=>state.refresh()},'Refresh queue'));}
      const root=createRoot(document.getElementById('fixture'));
      root.render(React.createElement(MemoryRouter,null,React.createElement(AdminSidebar),React.createElement(Queue)));
      window.unmountFixture=()=>root.unmount();
    </script>` }));
  await page.clock.install({ time: new Date('2026-09-17T12:00:00Z') });
  await page.goto('/__admin-poll-fixture');
  await expect(page.getByText('Queue ready', { exact: true })).toBeVisible();
  await expect(page.locator('.bell-badge')).toHaveText('7');
  await expect.poll(() => page.evaluate(() => (window as any).streams.length)).toBe(1);
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)));
}

test('@mocked admin idle and hidden polling stays bounded while actions and SSE remain active', async ({ page }) => {
  let queueReads = 0; let unreadReads = 0; let active = false;
  await page.route(`${API_BASE_URL}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/processing/queue')) {
      queueReads++;
      return route.fulfill({ json: { active: [], queued: {}, recent: [], worker: {}, counts: {
        activeCount: active ? 1 : 0, queuedTranscription: 0, queuedMetadata: 0, queuedEntityExtraction: 0, queuedExtraContent: 0,
      } } });
    }
    if (path.endsWith('/unread-count')) { unreadReads++; return route.fulfill({ json: { count: 7, maxSeverity: 'error' } }); }
    if (path.endsWith('/stream-token')) return route.fulfill({ json: { token: 'local-fixture-only', expiresAt: Date.now() + 30000 } });
    return route.fulfill({ json: { notifications: [] } });
  });
  await openFixture(page);
  await page.evaluate(() => (window as any).streams[0].emit('connected'));
  await expect.poll(() => unreadReads).toBe(2);
  await page.waitForTimeout(50);
  for (let expected = 2; expected <= 3; expected++) {
    await page.clock.runFor(30_000);
    await expect.poll(() => queueReads).toBe(expected);
    await expect(page.getByText('Queue ready', { exact: true })).toBeVisible();
  }
  expect(unreadReads).toBe(2);
  await page.evaluate(() => (window as any).setVisibility('hidden'));
  await page.clock.runFor(300_000);
  expect(queueReads).toBe(3); expect(unreadReads).toBe(2);
  expect(await page.evaluate(() => (window as any).streams[0].closed)).toBe(false);
  await page.evaluate(() => (window as any).streams[0].emit('notification', { id: 'new', read: false, severity: 'critical' }));
  await expect(page.locator('.bell-badge')).toHaveText('8');
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect.poll(() => queueReads).toBe(4);
  await expect(page.getByText('Queue ready', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).setVisibility('visible'); window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => queueReads).toBe(5);
  await expect.poll(() => unreadReads).toBe(3);
  await expect(page.getByText('Queue ready', { exact: true })).toBeVisible();
  active = true;
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect.poll(() => queueReads).toBe(6);
  await expect(page.getByText('Queue ready', { exact: true })).toBeVisible();
  await page.clock.runFor(5_000);
  await expect.poll(() => queueReads).toBe(7);
  await page.evaluate(() => (window as any).unmountFixture());
  await page.clock.runFor(300_000);
  expect(queueReads).toBe(7); expect(unreadReads).toBe(3);
  expect(await page.evaluate(() => (window as any).streams[0].closed)).toBe(true);
});
