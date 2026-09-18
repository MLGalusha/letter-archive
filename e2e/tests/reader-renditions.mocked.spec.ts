import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

async function mount(page: Page) {
  page.on("pageerror", error => console.log("Fixture page error:", error.message));
  page.on("requestfailed", request => console.log("Fixture request failed:", request.url(), request.failure()));
  page.on("console", message => { if (message.type() === "error") console.log("Fixture console:", message.text()); });
  await page.route('**/__reader-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body {margin:0} #fixture {width:360px} .viewer-container {width:360px!important;height:500px!important}</style>
    <div id="fixture"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {ReaderScanImage}=await import('/src/components/LetterViewer/ReaderScanImage.tsx');
      const {PreviewImage}=await import('/src/components/common/PreviewImage.tsx');
      const {default:LetterViewer}=await import('/src/components/LetterViewer/LetterViewer.tsx');
      const {getImageUrl}=await import('/src/api/client.ts');
      const {imagePreloadService}=await import('/src/services/imagePreloadService.ts');
      window.markCached=(imageUrl,width=1200)=>imagePreloadService.recordLoaded(getImageUrl(imageUrl,{width}),{naturalWidth:width,naturalHeight:width*4/3});
      window.readerReady=false;
      const root=createRoot(document.getElementById('fixture'));
      window.renderReader=(props)=>root.render(React.createElement(ReaderScanImage,{imageUrl:'/fixture-images/scan?v=one',alt:'Reader scan',loading:'eager',onReadyChange:(ready)=>{window.readerReady=ready},style:{width:360,position:'relative'},...props}));
      window.renderCard=()=>root.render(React.createElement(PreviewImage,{src:getImageUrl('/fixture-images/scan?v=one',{width:480}),alt:'Card scan'}));
      window.renderViewer=()=>root.render(React.createElement(LetterViewer,{variant:'lightbox',images:[
        {id:'one',type:'letter',pageNumber:1,imageUrl:'/fixture-images/one?v=one',width:1200,height:1600},
        {id:'two',type:'letter',pageNumber:2,imageUrl:'/fixture-images/two?v=one',width:1200,height:1600},
        {id:'three',type:'letter',pageNumber:3,imageUrl:'/fixture-images/three?v=one',width:1200,height:1600}
      ]}));
    </script>` }));
  await page.goto('/__reader-fixture');
  await page.waitForFunction(() => typeof (window as any).renderReader === 'function');
}
const png = join(__dirname, 'fixtures/archive-preview-480x640.png');

test('@mocked reader hands off a versioned clear card preview while only its measured rendition loads', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const urls: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/fixture-images/**', async route => {
    urls.push(route.request().url());
    if (new URL(route.request().url()).searchParams.get('w') === '1200') await held;
    await route.fulfill({ contentType: 'image/png', path: png });
  });
  try {
    await mount(page);
    await page.evaluate(() => (window as any).renderCard());
    await expect.poll(() => page.getByAltText('Card scan').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(480);
    await page.evaluate(() => (window as any).renderReader());
    await expect(page.locator('.progressive-image__thumb')).toHaveAttribute('src', /w=480/);
    await expect(page.locator('.progressive-image__thumb')).toBeVisible();
    await expect.poll(() => urls.some(url => url.includes('w=1200'))).toBe(true);
    expect(urls.some(url => /w=(32|800)(?:&|$)/.test(url))).toBe(false);
    release();
    await expect(page.getByAltText('Reader scan')).toHaveAttribute('src', /w=1200/);
    await page.evaluate(() => { document.getElementById('fixture')!.style.width = '120px'; });
    await expect(page.getByAltText('Reader scan')).toHaveAttribute('src', /w=480/);
    await page.evaluate(() => (window as any).renderReader({ imageUrl: '/fixture-images/scan?v=two' }));
    await expect(page.getByAltText('Reader scan')).toHaveAttribute('src', /v=two.*w=480/);
    await expect.poll(() => urls.some(url => url.includes('v=two') && url.includes('w=480'))).toBe(true);
  } finally { release(); await context.close(); }
});

test('@mocked direct reader entry requests no guessed 800 or extra 480 tier at phone DPR', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage(); const urls: string[] = [];
  await page.route('**/fixture-images/**', async route => { urls.push(route.request().url()); await route.fulfill({ contentType: 'image/png', path: png }); });
  try {
    await mount(page); await page.evaluate(() => (window as any).renderReader());
    await expect(page.getByAltText('Reader scan')).toHaveAttribute('src', /w=1200/);
    expect(urls.every(url => /w=(32|1200)(?:&|$)/.test(url))).toBe(true);
  } finally { await context.close(); }
});

test('@mocked viewer waits for the active measured rendition before bounded matching neighbors', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage(); const urls: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/fixture-images/**', async route => {
    const url = route.request().url(); urls.push(url);
    if (url.includes('/one?') && url.includes('w=1200')) await held;
    await route.fulfill({ contentType: 'image/png', path: png });
  });
  try {
    await mount(page); await page.evaluate(() => { (window as any).markCached('/fixture-images/one?v=one'); (window as any).renderViewer(); });
    await expect.poll(() => urls.some(url => url.includes('w=1200'))).toBe(true);
    expect(urls.every(url => url.includes('/one?'))).toBe(true);
    release();
    await expect.poll(() => urls.filter(url => /\/(two|three)\?/.test(url)).length).toBe(2);
    expect(urls.every(url => /w=(32|1200)(?:&|$)/.test(url))).toBe(true);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('.viewer-image')).toHaveAttribute('src', /\/two\?.*w=1200/);
    expect(urls.some(url => /w=800(?:&|$)/.test(url))).toBe(false);
  } finally { release(); await context.close(); }
});

for (const reducedData of [false, true]) {
  test(`@mocked letter carousel prioritizes active scan and honors reduced data ${reducedData}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const page = await context.newPage(); const urls: string[] = [];
    await page.addInitScript(saveData => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData } }), reducedData);
    await page.route('**/settings/public', route => route.fulfill({ json: {} }));
    await page.route('**/letters/**', route => {
      if (route.request().url().includes('/adjacent')) return route.fulfill({ json: null });
      return route.fulfill({ json: {
        id: 'reader-renditions', collectionCode: '003', metadata: { hook: 'Reader rendition fixture', verified: true },
        images: [1, 2, 3, 4].map(pageNumber => ({ id: `scan-${pageNumber}`, type: 'letter', pageNumber,
          imageUrl: `/fixture-images/scan-${pageNumber}?v=one`, width: 1200, height: 1600 })),
        transcript: { pages: [], fullText: '', verified: true }, status: 'published', visibility: 'PUBLISHED',
        transcriptPublished: true, metadataPublished: true, transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED', extraContentStatus: 'EMPTY',
      } });
    });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/fixture-images/**', async route => {
      const url = route.request().url(); urls.push(url);
      if (url.includes('scan-1?') && url.includes('w=800')) await held;
      await route.fulfill({ contentType: 'image/png', path: png });
    });
    try {
      await page.goto('/letter/reader-renditions');
      await expect.poll(() => urls.some(url => url.includes('w=800'))).toBe(true);
      expect(urls.every(url => url.includes('scan-1?'))).toBe(true);
      release();
      await expect(page.getByAltText('Page 1 of letter')).toHaveAttribute('src', /w=800/);
      if (reducedData) {
        await page.waitForTimeout(150);
        expect(urls.every(url => url.includes('scan-1?'))).toBe(true);
      } else {
        await expect.poll(() => urls.some(url => url.includes('scan-2?') && url.includes('w=800'))).toBe(true);
        expect(urls.some(url => url.includes('scan-4?'))).toBe(false);
      }
      await page.getByRole('button', { name: 'Go to page 3', exact: true }).click();
      await expect(page.getByAltText('Page 3 of letter')).toHaveAttribute('src', /w=800/);
      expect(urls.some(url => /w=(1200|1600)(?:&|$)/.test(url))).toBe(false);
      await page.getByRole('button', { name: 'Go to page 1', exact: true }).click();
      // A cached src is already present before the carousel returns to page 1.
      // Resize only once that page is actually active and horizontal motion ends.
      await expect(page.getByRole('button', { name: 'Go to page 1', exact: true })).toHaveClass(/active/);
      await expect.poll(() => page.locator('.scan-carousel').evaluate(el => el.scrollLeft)).toBeCloseTo(0, 0);
      await expect(page.getByAltText('Page 1 of letter')).toHaveAttribute('src', /w=800/);
      const beforeResize = urls.length;
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(page.getByAltText('Page 1 of letter')).toHaveAttribute('src', /w=1200/);
      expect(urls.slice(beforeResize).some(url => /scan-(3|4)\?/.test(url) && url.includes('w=1200'))).toBe(false);
    } finally { release(); await context.close(); }
  });
}

test('@mocked cached readiness metadata does not admit neighbors before the displayed reader image loads', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  let started = false; let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/fixture-images/**', async route => {
    if (new URL(route.request().url()).searchParams.get('w') === '1200') { started = true; await held; }
    await route.fulfill({ contentType: 'image/png', path: png });
  });
  try {
    await mount(page);
    await page.evaluate(() => { (window as any).markCached('/fixture-images/scan?v=one'); (window as any).renderReader(); });
    await expect.poll(() => started).toBe(true);
    expect(await page.evaluate(() => (window as any).readerReady)).toBe(false);
    await expect(page.locator('.progressive-image__thumb')).toHaveAttribute('src', /w=32/);
    await expect(page.locator('.progressive-image__thumb')).toBeVisible();
    await expect.poll(() => page.locator('.progressive-image__thumb').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(480);
    release();
    await expect.poll(() => page.evaluate(() => (window as any).readerReady)).toBe(true);
  } finally { release(); await context.close(); }
});

for (const cacheControl of ['no-store', 'max-age=0']) {
  test(`@mocked fullscreen retains its preview and makes one native full request with ${cacheControl}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const page = await context.newPage(); const urls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } }));
    await page.route('**/fixture-images/**', async route => {
      const url = route.request().url(); urls.push(url);
      if (url.includes('w=1200')) await held;
      await route.fulfill({ contentType: 'image/png', headers: { 'cache-control': cacheControl }, path: png });
    });
    try {
      await mount(page); await page.evaluate(() => (window as any).renderViewer());
      await expect.poll(() => urls.filter(url => url.includes('w=1200')).length).toBe(1);
      await expect(page.locator('.viewer-image-thumb')).toBeVisible();
      await expect.poll(() => page.locator('.viewer-image-thumb').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(480);
      await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '0');
      release();
      await expect(page.locator('.viewer-image')).toHaveCSS('opacity', '1');
      await expect(page.locator('.viewer-image-thumb')).toHaveCount(0);
      expect(urls.filter(url => url.includes('w=1200'))).toHaveLength(1);
      expect(urls.every(url => url.includes('/one?'))).toBe(true);
    } finally { release(); await context.close(); }
  });
}

for (const previewFails of [false, true]) {
  test(`@mocked fullscreen full failure preserves a working preview or reports both failures: ${previewFails}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const page = await context.newPage(); const urls: string[] = [];
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } }));
    await page.route('**/fixture-images/**', async route => {
      const url = route.request().url(); urls.push(url);
      if (url.includes('w=1200') || previewFails) return route.fulfill({ status: 503, body: 'Temporarily unavailable' });
      return route.fulfill({ contentType: 'image/png', path: png });
    });
    try {
      await mount(page);
      await page.evaluate(() => { (window as any).markCached('/fixture-images/one?v=one',480); (window as any).renderViewer(); });
      await expect.poll(() => urls.filter(url => url.includes('w=1200')).length).toBe(3);
      await expect(page.locator('.viewer-image')).not.toBeVisible();
      if (previewFails) {
        await expect.poll(() => urls.filter(url => url.includes('w=480')).length).toBe(3);
        await expect(page.locator('.viewer-image-thumb')).not.toBeVisible();
        await expect(page.getByRole('status', { name: '', exact: true })).toHaveText('Image unavailable');
      } else {
        await expect(page.locator('.viewer-image-thumb')).toBeVisible();
        await expect.poll(() => page.locator('.viewer-image-thumb').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(480);
        await expect(page.getByRole('status', { name: '', exact: true })).toHaveCount(0);
      }
    } finally { await context.close(); }
  });
}
