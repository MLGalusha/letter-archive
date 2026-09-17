async owner => {
  const results = [];
  for (const width of [390, 1440]) {
    const context = await owner.context().browser().newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: width === 390 ? 3 : 1 });
    const page = await context.newPage();
    const dimensions = { '/blog-images/hero.jpg': { width: 3000, height: 4000 }, '/blog-images/inline.jpg': { width: 900, height: 600 }, '/blog-images/float.jpg': { width: 400, height: 800 }, '/blog-images/failed.jpg': { width: 900, height: 600 } };
    const post = { id: 'fixture', slug: 'fixture', title: 'Reserved journal layout', heroImageUrl: '/blog-images/hero.jpg', heroImageAlt: 'Hero', imageDimensions: dimensions,
      bodyMarkdown: 'Before inline.\n\n![Inline][scan]\n\nAfter inline.\n\n![Float](/blog-images/float.jpg "float-left")\n\nThis text wraps beside the original proportions.\n\n![Failed](/blog-images/failed.jpg)\n\nAfter all images.', publishedAt: '2026-09-17', createdAt: '2026-09-17' };
    post.bodyMarkdown += '\n\n[scan]: /blog-images/inline.jpg';
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let imageRequests = 0;
    await page.route('http://127.0.0.1:4197/**', async route => {
      const url = route.request().url();
      const path = url.replace('http://127.0.0.1:4197', '').split('?')[0];
      const headers = { 'access-control-allow-origin': 'http://127.0.0.1:4198', 'access-control-allow-credentials': 'true' };
      if (path.startsWith('/blog-images/')) {
        imageRequests++; await held;
        if (path.includes('failed')) { await route.fulfill({ status: 503, body: '', headers }); return; }
        const size = dimensions[path];
        await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="tan"/></svg>`, headers }); return;
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(path === '/blog/fixture' ? post : path === '/collections' ? [] : {}), headers });
    });
    await page.goto('http://127.0.0.1:4198/blog/fixture', { waitUntil: 'domcontentloaded' });
    await page.getByText('After all images.', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('img[alt="Failed"]').scrollIntoViewIfNeeded();
    const measure = () => page.evaluate(() => ({ images: [...document.querySelectorAll('article img')].map(image => ({ alt: image.alt, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, top: image.getBoundingClientRect().top - document.querySelector('article img').getBoundingClientRect().top, complete: image.complete, title: image.title })), after: [...document.querySelectorAll('p')].find(p => p.textContent === 'After all images.').getBoundingClientRect().top - document.querySelector('article img').getBoundingClientRect().top }));
    const before = await measure();
    if (before.images.some(image => image.height < 1 || image.complete)) throw new Error('Image was not held with reserved space: ' + JSON.stringify(before));
    release();
    await page.waitForFunction(() => [...document.querySelectorAll('article img')].every(image => image.complete && image.naturalWidth > 0));
    const after = await measure();
    for (let index = 0; index < before.images.length; index++) for (const key of ['width', 'height', 'top']) if (Math.abs(before.images[index][key] - after.images[index][key]) > 1) throw new Error(`Layout moved: ${before.images[index].alt} ${key} ` + JSON.stringify({ before, after }));
    if (Math.abs(before.after - after.after) > 1) throw new Error('Downstream text moved');
    if (after.images.find(image => image.alt === 'Float').title !== 'float-left') throw new Error('Lost wrap title');
    results.push({ width, before, after, imageRequests });
    await context.close();
  }
  return results;
}
