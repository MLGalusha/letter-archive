import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageVariantStore, MAX_SAVED_PREVIEW_BYTES } from '../image-variant-store.js';

const identity = (value: string) => createHash('sha256').update(value).digest('hex');
const key = identity('source:480:avif');
let root: string;
const location = (id = key) => join(root, 'image-previews-v1', id.slice(0, 2), `${id}.preview`);

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'archive-preview-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('durable card preview store', () => {
  it('reuses complete bytes in an independent store and does not mix identities', async () => {
    const bytes = Buffer.from('encoded image bytes');
    expect(await new ImageVariantStore(root).write(key, 480, 'avif', bytes)).toBe('saved');
    expect(await new ImageVariantStore(root).read(key, 480, 'avif')).toEqual({ status: 'hit', buffer: bytes });
    expect(await new ImageVariantStore(root).read(identity('changed source'), 480, 'avif')).toEqual({ status: 'miss' });
  });

  it('reads a saved variant after starting a new Node process', async () => {
    const bytes = Buffer.from('survives process restart');
    expect(await new ImageVariantStore(root).write(key, 480, 'avif', bytes)).toBe('saved');
    const moduleUrl = new URL('../image-variant-store.ts', import.meta.url).href;
    const code = `import {ImageVariantStore} from ${JSON.stringify(moduleUrl)};
      const result=await new ImageVariantStore(${JSON.stringify(root)}).read(${JSON.stringify(key)},480,'avif');
      console.log(JSON.stringify({status:result.status,body:result.buffer?.toString()}));`;
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
      cwd: new URL('../../../', import.meta.url), maxBuffer: 4096,
    });
    expect(JSON.parse(stdout)).toEqual({ status: 'hit', body: bytes.toString() });
  });

  it('reuses all24 saved variants in a fresh store during an ordinary card burst', async () => {
    const writer = new ImageVariantStore(root);
    for (let i = 0; i < 24; i++) expect(await writer.write(identity(`${i}`), 480, 'webp', Buffer.from(`image ${i}`))).toBe('saved');
    const reader = new ImageVariantStore(root);
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => reader.read(identity(`${i}`), 480, 'webp')));
    expect(results.every((result) => result.status === 'hit')).toBe(true);
  });

  it.each(['avif', 'webp', 'jpeg'] as const)('supports480px %s only and rejects arbitrary paths/widths/formats', async (format) => {
    const store = new ImageVariantStore(root);
    expect(await store.write(key, 480, format, Buffer.from('bytes'))).toBe('saved');
    expect((await store.read(key, 480, format)).status).toBe('hit');
    expect(await store.write(key, 479, format, Buffer.from('bytes'))).toBe('unsupported');
    expect(await store.read(key, 800, format)).toEqual({ status: 'unsupported' });
    expect(await store.write('../escape', 480, format, Buffer.from('bytes'))).toBe('unsupported');
    expect(await store.read(key, 480, 'png' as typeof format)).toEqual({ status: 'unsupported' });
  });

  it('rejects incomplete, altered, wrong-identity and oversized envelopes', async () => {
    const store = new ImageVariantStore(root);
    await store.write(key, 480, 'avif', Buffer.from('valid payload'));
    const valid = await readFile(location());
    const modified = Buffer.from(valid); modified[modified.length - 1] ^= 1;
    const wrongIdentity = Buffer.from(valid); wrongIdentity[8] ^= 1;
    for (const bad of [Buffer.alloc(0), valid.subarray(0, 76), valid.subarray(0, -1), modified, wrongIdentity, Buffer.concat([valid, Buffer.from('extra')]), Buffer.alloc(MAX_SAVED_PREVIEW_BYTES + 77)]) {
      await writeFile(location(), bad);
      expect(await store.read(key, 480, 'avif')).toEqual({ status: 'invalid' });
    }
    expect(await store.write(key, 480, 'avif', Buffer.alloc(MAX_SAVED_PREVIEW_BYTES + 1))).toBe('oversized');
    expect(await store.write(key, 480, 'avif', Buffer.alloc(0))).toBe('oversized');
  });

  it('tolerates concurrent independent writers and rejects interrupted writes until complete', async () => {
    const left = new ImageVariantStore(root), right = new ImageVariantStore(root);
    const bytes = Buffer.alloc(100_000, 42);
    const results = await Promise.all([left.write(key, 480, 'jpeg', bytes), right.write(key, 480, 'jpeg', bytes)]);
    expect(results).toEqual(['saved', 'saved']);
    expect(await right.read(key, 480, 'jpeg')).toEqual({ status: 'hit', buffer: bytes });
    const complete = await readFile(location());
    await writeFile(location(), complete.subarray(0, complete.length / 2));
    expect(await left.read(key, 480, 'jpeg')).toEqual({ status: 'invalid' });
    expect(await left.write(key, 480, 'jpeg', bytes)).toBe('saved');
    expect((await right.read(key, 480, 'jpeg')).status).toBe('hit');
  });

  it('never treats an open, partially written file as a ready preview', async () => {
    const store = new ImageVariantStore(root);
    const bytes = Buffer.from('complete payload');
    await store.write(key, 480, 'avif', bytes);
    const complete = await readFile(location());
    const handle = await open(location(), 'w');
    try {
      await handle.write(complete.subarray(0, 80));
      expect(await new ImageVariantStore(root).read(key, 480, 'avif')).toEqual({ status: 'invalid' });
      await handle.write(complete.subarray(80));
    } finally { await handle.close(); }
    expect(await store.read(key, 480, 'avif')).toEqual({ status: 'hit', buffer: bytes });
  });

  it('bounds active writes/reads without queues and releases admission after failure', async () => {
    const store = new ImageVariantStore(root);
    const writes = Array.from({ length: 5 }, (_, i) => store.write(identity(`burst${i}`), 480, 'avif', Buffer.from('bytes')));
    expect(await Promise.all(writes)).toEqual(['saved', 'saved', 'busy', 'busy', 'busy']);
    const reads = Array.from({ length: 41 }, () => store.read(identity('missing'), 480, 'avif'));
    expect((await Promise.all(reads)).filter((result) => result.status === 'busy')).toHaveLength(1);
    // A file where the root directory should be makes both read and write fail.
    const blocked = join(root, 'blocked'); await writeFile(blocked, 'not a directory');
    const unavailable = new ImageVariantStore(blocked);
    expect(await unavailable.write(key, 480, 'avif', Buffer.from('bytes'))).toBe('error');
    expect(await unavailable.read(key, 480, 'avif')).toEqual({ status: 'error' });
    await rm(blocked); await mkdir(blocked);
    expect(await unavailable.write(key, 480, 'avif', Buffer.from('bytes'))).toBe('saved');
    expect((await unavailable.read(key, 480, 'avif')).status).toBe('hit');
  });
});
