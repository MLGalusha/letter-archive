import { expect, test } from '@playwright/test';
import { openReader, closeReader, mockReader, viewerImages } from './utils/reader-viewer-fixture';
const many = Array.from({length: 24}, (_, i) => ({...viewerImages[0], id:`scan-${i}`, pageNumber:i+1, imageUrl:`/images/${i}.svg`}));

for (const width of [320, 390, 844, 1440]) test(`@mocked thumbnail browsing is independent of activation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({width, height:width===844?390:900});
  await mockReader(page, many); await page.goto('/letter/current');
  const inline = page.locator('.letter-scan-figure .viewer-page-drawer');
  await expect(inline).toBeVisible();
  await inline.evaluate(el => { el.scrollLeft = 600; });
  await page.waitForTimeout(250);
  await expect(inline.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 1: letter');
  await inline.locator('button').nth(10).click();
  await expect(inline.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 11: letter');
  await page.getByRole('button',{name:'Open scan 11 full screen',exact:true}).click();
  const dialog = page.getByRole('dialog'); const strip = dialog.locator('.viewer-page-drawer');
  const frame = page.locator('.reader-focus-strip');
  const frameBox = (await frame.boundingBox())!, stripBox = (await strip.boundingBox())!;
  expect(stripBox.x).toBeGreaterThanOrEqual(frameBox.x);
  expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width);
  await expect(frame).toHaveCSS('overflow', 'hidden');
  await expect(dialog.getByRole('button', { name: /Zoom in|Zoom out|Reset zoom/ })).toHaveCount(0);
  const closeTarget = (await dialog.getByRole('button', { name: 'Close viewer' }).boundingBox())!;
  expect(closeTarget.width).toBe(44);
  expect(closeTarget.height).toBe(44);
  await strip.evaluate(el => { el.scrollLeft=0; });
  await page.waitForTimeout(250);
  await expect(strip.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 11: letter');
  await strip.locator('button').first().click();
  await expect(dialog).toBeVisible();
  await expect(strip.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 1: letter');
  await strip.locator('button').first().press('End');
  await expect(strip.locator('button').last()).toBeFocused();
  await expect(strip.locator('button').last()).toHaveAttribute('aria-current','page');
  const bounds=(await strip.boundingBox())!, last=(await strip.locator('button').last().boundingBox())!;
  expect(last.x).toBeGreaterThanOrEqual(bounds.x);
  expect(last.x+last.width).toBeLessThanOrEqual(bounds.x+bounds.width+1);
  const close=await dialog.getByRole('button',{name:'Close viewer'}).boundingBox();
  expect(close!.y).toBeGreaterThanOrEqual(0);
  await closeReader(page);
});

test('@mocked zoomed pan clamps to the full stage before and after rotation', async ({ page }) => {
  await page.setViewportSize({width:390,height:844}); await openReader(page);
  for(let i=0;i<6;i++) await page.keyboard.press('+');
  for(const size of [{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(size);
    await expect(page.locator('.viewer-transform')).not.toHaveClass(/animating/);
    for(const delta of [-10000,10000]) {
      await page.locator('.viewer-container').dispatchEvent('wheel',{deltaY:delta,deltaX:delta,bubbles:true,cancelable:true});
      await expect.poll(()=>page.locator('.viewer-transform').evaluate(el=>{
        const image=el.getBoundingClientRect(),stage=el.closest('.viewer-container')!.getBoundingClientRect();
        return Math.max(image.left-stage.left,image.top-stage.top,stage.right-image.right,stage.bottom-image.bottom);
      })).toBeLessThan(1);
    }
  }
});

test('@mocked simulated safe areas inset controls while keeping the image stage full size', async ({ page, browserName }) => {
  test.skip(browserName!=='chromium','CDP simulation is not physical iOS validation.');
  await page.setViewportSize({width:390,height:844}); await openReader(page);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:59,bottom:34,left:0,right:0}});
  const stage=await page.locator('.reader-focus-backdrop').boundingBox(); expect(stage).toEqual({x:0,y:0,width:390,height:844});
  const close=await page.getByRole('button',{name:'Close viewer'}).boundingBox(); expect(close!.y).toBeGreaterThanOrEqual(59);
  const strip=await page.locator('.reader-focus-strip').boundingBox(); expect(strip!.y+strip!.height).toBeLessThanOrEqual(810);
});

test.describe('native touch',()=>{
  test.use({hasTouch:true,deviceScaleFactor:3});
  test('@mocked thumbnail drag never activates and a subsequent tap activates once',async({page,browserName})=>{
    test.skip(browserName!=='chromium','Trusted CDP touch is Chromium-only.');
    await page.setViewportSize({width:390,height:844}); await openReader(page,many);
    const strip=page.getByRole('dialog').locator('.viewer-page-drawer'), box=(await strip.boundingBox())!;
    const cdp=await page.context().newCDPSession(page), y=box.y+box.height/2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:300,y,id:1}]});
    for(const x of [270,230,190,150,100]) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(350);
    expect(await strip.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    await expect(strip.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 1: letter');
    await strip.locator('button').nth(6).tap();
    await expect(strip.locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 7: letter');
    await expect(page.getByRole('dialog')).toBeVisible();
  });
  test('@mocked a pinch holds its rendition until release and hands off to pan',async({page,browserName})=>{
    test.skip(browserName!=='chromium','Trusted CDP multi-touch is Chromium-only.');
    await page.setViewportSize({width:390,height:844}); await openReader(page);
    const image=page.locator('.viewer-image'); await expect(image).toHaveCSS('opacity','1');
    const source=await image.getAttribute('src'); const box=(await image.boundingBox())!, x=box.x+box.width/2,y=box.y+box.height/2;
    const points=(distance:number)=>[{x:x-distance/2,y,id:1},{x:x+distance/2,y,id:2}];
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(100)});
    for(const distance of [120,150,180,220]) {await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(distance)});await expect(image).toHaveAttribute('src',source!);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:x+110,y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+120,y:y+30,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator('.letter-viewer')).toHaveAttribute('data-zoom','2.2');
    await expect(image).not.toHaveAttribute('src',source!);
    await expect(page.getByRole('dialog').locator('[aria-current="page"]')).toHaveAccessibleName('Go to scan 1: letter');
  });
});
