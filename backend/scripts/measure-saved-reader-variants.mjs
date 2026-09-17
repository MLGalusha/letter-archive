// Run from backend: node --import tsx scripts/measure-saved-reader-variants.mjs
// Uses a checked-in scan and a temporary store. No database or network access.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ImageVariantStore } from '../src/services/image-variant-store.ts';
import { imageVariantIdentity } from '../src/services/image-variant.ts';

const fixture = fileURLToPath(new URL('../../frontend/src/assets/mock/002-L-12141900-3.jpg', import.meta.url));
const script = fileURLToPath(import.meta.url);
const [mode, root, widthArg] = process.argv.slice(2);
if (mode === 'generate' || mode === 'reuse') {
  const width = Number(widthArg);
  const stats = await stat(fixture);
  const checksumSha256 = createHash('sha256').update(await readFile(fixture)).digest('hex');
  const identity = imageVariantIdentity({ pageId: 'local-benchmark', storagePath: fixture,
    checksumSha256, size: stats.size, mtimeMs: stats.mtimeMs }, width, 'avif');
  const store = new ImageVariantStore(root);
  const started = performance.now();
  const saved = await store.read(identity, width, 'avif');
  let bytes = saved.status === 'hit' ? saved.buffer : undefined;
  let transforms = 0;
  if (!bytes) {
    if (mode === 'reuse') throw new Error(`Fresh process could not reuse ${width}px: ${saved.status}`);
    transforms++;
    bytes = await sharp(fixture).rotate().resize({ width, fit: 'inside', withoutEnlargement: true })
      .avif({ quality: 60, effort: 2 }).toBuffer();
    if (await store.write(identity, width, 'avif', bytes) !== 'saved') throw new Error('Save failed');
  }
  console.log(JSON.stringify({ width, mode, cache: saved.status, transforms,
    operationMs: Number((performance.now() - started).toFixed(2)), bytes: bytes.length,
    etag: `W/"preview-${identity}"`, sha256: createHash('sha256').update(bytes).digest('hex') }));
} else {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'reader-variants-measure-'));
  try {
    const results = [];
    for (const width of [480, 800, 1200, 1600]) {
      const pair = [];
      for (const phase of ['generate', 'reuse']) {
        const { stdout } = await promisify(execFile)(process.execPath,
          ['--import', 'tsx', script, phase, temporaryRoot, String(width)]);
        pair.push(JSON.parse(stdout));
      }
      if (pair[0].sha256 !== pair[1].sha256 || pair[0].etag !== pair[1].etag || pair[1].transforms !== 0)
        throw new Error(`Representation mismatch for ${width}px`);
      results.push(...pair);
    }
    console.log(JSON.stringify({ fixture, note: 'Local filesystem operation timing, excludes process startup and HTTP. Not a production speed estimate.', results }, null, 2));
  } finally { await rm(temporaryRoot, { recursive: true, force: true }); }
}
