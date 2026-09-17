async page => {
  const results = [];
  for (const count of [1, 3]) {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const tab = await context.newPage();
    const requests = [];
    tab.on('request', request => { if (request.url().includes('/blog-images/')) requests.push(request.url()); });
    await tab.route('**/blog?*', async route => {
      const response = await route.fetch();
      const data = await response.json();
      const posts = Array.from({ length: count }, (_, index) => ({ ...data.posts[0], id: `post-${index}`, slug: `post-${index}` }));
      await route.fulfill({ response, json: { posts, total: count } });
    });
    await tab.goto('http://127.0.0.1:4196/blog');
    await tab.waitForFunction(count => {
      const images = [...document.querySelectorAll('.update-card-image img')];
      return images.length === count && images.every(image => image.complete && image.naturalWidth > 0);
    }, count);
    const images = await tab.locator('.update-card-image img').evaluateAll(images => images.map(image => ({ url: image.currentSrc, width: image.getBoundingClientRect().width, sizes: image.sizes })));
    for (const image of images) {
      const selected = Number(image.url.match(/[?&]w=(\d+)/)?.[1]);
      if (selected < Math.min(image.width, 1600)) throw new Error(`Undersized ${selected}px candidate for ${image.width}px card`);
      if (image.sizes !== 'auto, 100vw') throw new Error('Missing native sizing/fallback');
    }
    if (requests.length > count || new Set(requests).size !== 1) throw new Error(`Unexpected duplicate rendition downloads: ${requests.join(',')}`);
    results.push({ count, images, requests });
    await context.close();
  }
  return results;
}
