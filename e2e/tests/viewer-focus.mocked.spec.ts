import { expect, test } from '@playwright/test';
import { openReader, closeReader } from './utils/reader-viewer-fixture';


for (const width of [390, 1440]) {
  test(`@mocked fullscreen owns focus and scan keys at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { opener, y, styles } = await openReader(page);
    const dialog = page.getByRole('dialog', { name: 'Original scans' });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Close viewer' })).toHaveCount(0);
    await expect(page.locator('#root')).toHaveAttribute('inert', '');
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press(i < 8 ? 'Tab' : 'Shift+Tab');
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    await opener.evaluate(el => (el as HTMLElement).focus());
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await dialog.focus();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('.viewer-page-counter')).toHaveText('1 / 3');
    await expect(page).toHaveURL(/\/letter\/current$/);
    await dialog.locator('.viewer-container').dblclick();
    await expect(dialog.locator('.letter-viewer')).toHaveAttribute('data-zoom', '2.5');
    await dialog.getByRole('button', { name: 'Go to scan 2: letter', exact: true }).click();
    await expect(dialog.locator('.viewer-page-counter')).toHaveText('2 / 3');
    await expect(dialog.locator('.letter-viewer')).toHaveAttribute('data-zoom', '1');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    expect((await page.locator('body').evaluate(el => el.style.cssText)) || '').toBe(styles || '');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(y, 0);
    // Closing gives the reader its normal adjacent-letter shortcut back.
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/letter\/next$/);
  });
}

test('@mocked leaving the route while fullscreen restores background interaction', async ({ page }) => {
  await page.goto('/about');
  await openReader(page);
  await expect(page.getByRole('dialog', { name: 'Original scans' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  expect(await page.locator('body').evaluate(el => el.style.position)).toBe('');
  await expect(page.locator('html')).toHaveCSS('overflow', 'visible');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 237, 225)');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5ede1');
});

test('@mocked pointer opening restores focus to its actual scan trigger', async ({ page }) => {
  const { opener } = await openReader(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Original scans' });
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Close viewer' })).toHaveCount(0);
  await closeReader(page);
  await expect(opener).toBeFocused();
});

test('@mocked shared dialogs preserve native radio group tab stops', async ({ page }) => {
  await page.route('**/__dialog-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <div id="fixture"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const {default:React}=await import('/node_modules/.vite/deps/react.js');
      const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
      const {Modal}=await import('/src/components/common/Modal.tsx');
      const h=React.createElement;
      const radio=(label,checked=false)=>h('input',{'aria-label':label,type:'radio',name:'entity',tabIndex:0,defaultChecked:checked});
      createRoot(document.getElementById('fixture')).render(h(Modal,{isOpen:true,title:'Choose entity',onClose:()=>{}},
        h('form',null,radio('First candidate'),radio('Selected candidate',true),radio('Last candidate')),
        h('form',null,radio('Other form candidate',true)),h('input',{'aria-label':'Notes'})
      ));
    </script>` }));
  await page.goto('/__dialog-fixture');
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Selected candidate')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Other form candidate')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Notes')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('Other form candidate')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByLabel('Selected candidate')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Last candidate')).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Other form candidate')).toBeFocused();
});
