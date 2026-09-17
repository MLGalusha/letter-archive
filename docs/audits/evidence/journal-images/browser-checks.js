async page => {
  const requests = [];
  page.on('request', request => { if (request.url().includes('/blog-images/')) requests.push(request.url()); });
  await page.goto('http://127.0.0.1:4196/blog');
  const card = page.getByAltText('Hero scan');
  await card.waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.update-card-image img'); return image?.complete && image.naturalWidth > 0; });
  const cardInfo = await card.evaluate(image => ({ url: image.currentSrc, loading: image.loading, box: image.getBoundingClientRect().toJSON(), size: image.sizes }));
  if (!/[?&]w=(480|800|1200|1600)(?:&|$)/.test(cardInfo.url)) throw new Error('Card requested original');
  await page.goto('http://127.0.0.1:4196/blog/fixture');
  await page.getByRole('heading', { name: 'Journal image fixture' }).waitFor();
  await page.waitForFunction(() => { const image = document.querySelector('.update-hero-image img'); return image?.complete && image.naturalWidth > 0; });
  const heroInfo = await page.getByAltText('Hero scan').evaluate(image => ({ url: image.currentSrc, priority: image.fetchPriority, box: image.getBoundingClientRect().toJSON() }));
  if (heroInfo.priority !== 'high' || !heroInfo.url.includes('w=')) throw new Error('Hero not a prioritized rendition');
  const inline = page.getByAltText('Inline scan');
  const inlineBefore = await inline.evaluate(image => ({ complete: image.complete, top: image.getBoundingClientRect().top, loading: image.loading }));
  if (inlineBefore.loading !== 'lazy' || requests.some(url => url.includes('inline=1'))) throw new Error('Distant inline image was loaded early');
  await inline.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const image = document.querySelector('img[alt="Inline scan"]'); return image?.complete && image.naturalWidth > 0; });
  const inlineInfo = await inline.evaluate(image => ({ url: image.currentSrc, box: image.getBoundingClientRect().toJSON() }));
  await page.getByAltText('Animated scan').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const image = document.querySelector('img[alt="Animated scan"]'); return image?.complete && image.naturalWidth > 0; });
  await page.getByAltText('Recovering scan').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const image = document.querySelector('img[alt="Recovering scan"]'); return image?.complete && image.naturalWidth > 0 && !image.currentSrc.includes('w='); });
  const recoveryInfo = await page.getByAltText('Recovering scan').evaluate(image => ({ url: image.currentSrc, srcset: image.srcset }));
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/blog-images/')).map(entry => ({ url: entry.name, durationMs: entry.duration, bytes: entry.encodedBodySize })));
  const decode = await page.evaluate(async () => {
    const results = [];
    for (const width of [null, 480, 1200]) {
      const response = await fetch(`http://127.0.0.1:4197/blog-images/scan.jpg${width ? `?w=${width}&rendition=1` : ''}`, { headers: { accept: 'image/webp' } });
      const blob = await response.blob();
      const started = performance.now();
      const bitmap = await createImageBitmap(blob);
      results.push({ requestedWidth: width, bytes: blob.size, decodeMs: performance.now() - started, width: bitmap.width, height: bitmap.height });
      bitmap.close();
    }
    return results;
  });
  return { cardInfo, heroInfo, inlineBefore, inlineInfo, recoveryInfo, resources, decode, requests };
}
