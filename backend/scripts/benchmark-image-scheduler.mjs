// Local real-route diagnostic. Owns a disposable PostgreSQL container and synthetic files.
// From backend: node --import tsx scripts/benchmark-image-scheduler.mjs --baseline-root=/path/to/5a54cce0-checkout > results.json
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, copyFile, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import postgres from 'postgres';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value) => Math.round(value * 100) / 100;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const pageId = (index) => `20000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
const letterId = (index) => `30000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;

if (argument('child')) {
  const config = JSON.parse(argument('child'));
  // Values supplied only by the parent that created this loopback fixture.
  assert.match(config.database, /^postgresql:\/\/postgres:fixture@127\.0\.0\.1:/);
  process.env.DATABASE_URL = config.database;
  process.env.STORAGE_DIR = config.directory;
  process.env.LOG_LEVEL = 'silent';
  const appRoot = config.mode === 'before' ? config.baselineRoot : root;
  const images = await import(pathToFileURL(path.join(appRoot, 'backend/src/routes/images.ts')).href);
  const letters = await import(pathToFileURL(path.join(appRoot, 'backend/src/routes/letters.ts')).href);
  const database = await import(pathToFileURL(path.join(appRoot, 'backend/src/db/index.ts')).href);
  const { ImageTransformScheduler } = await import('../src/services/image-transform-scheduler.ts');
  const scheduler = config.mode === 'before' ? null : new ImageTransformScheduler({ concurrency: Number(config.mode), maxQueued: 32, maxWaiters: 64 });
  const express = (await import('express')).default;
  const compression = (await import('compression')).default;
  const app = express();
  const rows = [];
  app.use((req, res, next) => {
    const row = { path: req.path, started: performance.now() };
    rows.push(row);
    req.log = Object.fromEntries(['info', 'debug', 'warn', 'error'].map((level) => [level, (fields, message) => {
      if (message === 'Archive search completed') { row.queryMs = fields.duration; row.beforeSend = performance.now(); }
      if (message === 'Image response completed') Object.assign(row, fields);
    }]));
    res.once('finish', () => {
      row.serverMs = performance.now() - row.started;
      if (row.beforeSend) row.responseTailMs = performance.now() - row.beforeSend;
    });
    next();
  });
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/images/') && compression.filter(req, res) }));
  app.use(scheduler ? images.createImagesRouter(scheduler) : images.default);
  app.use(letters.default);
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const expectedImage = await readFile(path.join(config.directory, 'expected.avif'));
  const request = (url, image = false) => new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.get({ host: '127.0.0.1', port, path: url, agent: false,
      headers: image ? { Accept: 'image/avif' } : { 'Accept-Encoding': config.encoding } }, (res) => {
      const ttfbMs = performance.now() - start;
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          assert.equal(res.statusCode, 200, `${url} status`);
          const body = Buffer.concat(chunks);
          if (image) assert.deepEqual(body, expectedImage);
          const encoding = res.headers['content-encoding'];
          const decoded = encoding === 'br' ? brotliDecompressSync(body) : encoding === 'gzip' ? gunzipSync(body) : body;
          if (!image) assert.equal(encoding, config.encoding);
          resolve({ ttfbMs: round(ttfbMs), totalMs: round(performance.now() - start), bytes: body.length,
            payload: image ? undefined : JSON.parse(decoded.toString()) });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error('Local request timeout')));
    req.on('error', reject);
  });
  try {
    const expectedSearch = (await request('/letters/search?search=needle&limit=24')).payload;
    assert.equal(expectedSearch.total, 24);
    rows.length = 0;
    const eventLoop = monitorEventLoopDelay({ resolution: 5 }); eventLoop.enable();
    const cpu = process.cpuUsage(); const started = performance.now();
    const memoryStart = process.memoryUsage(); let peakRss = memoryStart.rss;
    let maxActive = 0; let maxQueued = 0;
    const sample = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      maxActive = Math.max(maxActive, scheduler?.state.active ?? sharp.counters().process);
      maxQueued = Math.max(maxQueued, scheduler?.state.queued ?? sharp.counters().queue);
    }, 5);
    const imageRequests = Array.from({ length: config.burst }, (_, index) => request(`/images/${pageId(index)}?w=480`, true));
    const searches = Array.from({ length: 6 }, async (_, index) => {
      await delay(5 + index * 25);
      const result = await request('/letters/search?search=needle&limit=24');
      assert.deepEqual(result.payload, expectedSearch);
      delete result.payload;
      return result;
    });
    const [imageResults, searchResults] = await Promise.all([Promise.all(imageRequests), Promise.all(searches)]);
    clearInterval(sample); eventLoop.disable();
    const elapsedCpu = process.cpuUsage(cpu);
    console.log(JSON.stringify({ mode: config.mode, burst: config.burst, encoding: config.encoding, repetition: config.repetition,
      node: process.version, sharp: sharp.versions, sharpConcurrency: sharp.concurrency(), cpuCount: os.cpus().length,
      uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? 'default (4)',
      searchPayloadHash: hash(JSON.stringify(expectedSearch)), imageHash: hash(expectedImage),
      wallMs: round(performance.now() - started), cpuMs: round((elapsedCpu.user + elapsedCpu.system) / 1000),
      rssStartBytes: memoryStart.rss, peakRssBytes: Math.max(peakRss, process.memoryUsage().rss),
      eventLoopMaxMs: round(eventLoop.max / 1e6), maxActive, maxQueued,
      images: imageResults, searches: searchResults,
      phases: rows.map(({ started, beforeSend, ...row }) => row),
    }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await database.closeDatabase();
  }
} else {
  const baselineRoot = argument('baseline-root');
  assert.ok(baselineRoot, 'Supply a clean baseline checkout at main5a54cce0 with backend dependencies installed');
  assert.equal(hash(await readFile(path.join(baselineRoot, 'backend/src/routes/images.ts'))),
    hash(execFileSync('git', ['show', '5a54cce0:backend/src/routes/images.ts'], { cwd: root })), 'baseline image route changed');
  assert.equal(hash(await readFile(path.join(baselineRoot, 'backend/src/routes/letters.ts'))),
    hash(await readFile(path.join(root, 'backend/src/routes/letters.ts'))), 'paired search routes must be identical');
  assert.equal(hash(await readFile(path.join(baselineRoot, 'backend/package-lock.json'))),
    hash(await readFile(path.join(root, 'backend/package-lock.json'))), 'paired dependency locks must be identical');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'archive-image-scheduler-'));
  let container; let client;
  try {
    let seed = 12345;
    const pixels = Buffer.alloc(2400 * 3200 * 3);
    for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
    const source = await sharp(pixels, { raw: { width: 2400, height: 3200, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    await writeFile(path.join(directory, 'source.jpg'), source);
    for (let index = 0; index < 24; index++) await copyFile(path.join(directory, 'source.jpg'), path.join(directory, `${index}.jpg`));
    await writeFile(path.join(directory, 'expected.avif'), await sharp(source).rotate().resize({ width: 480, fit: 'inside', withoutEnlargement: true }).avif({ quality: 60, effort: 2 }).toBuffer());
    container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_PASSWORD=fixture', '-e', 'POSTGRES_DB=archive_fixture', '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { encoding: 'utf8' }).trim();
    const binding = execFileSync('docker', ['port', container, '5432'], { encoding: 'utf8' }).trim();
    const database = `postgresql://postgres:fixture@${binding}/archive_fixture`;
    client = postgres(database, { max: 1 });
    for (let attempt = 0; ; attempt++) { try { await client`SELECT 1`; break; } catch (error) { if (attempt >= 30) throw error; await delay(200); } }
    await client.unsafe(`CREATE EXTENSION pg_trgm;
      CREATE TYPE letter_type AS ENUM ('L','C','P','E','V','A','D','N','T');
      CREATE TABLE collections (id uuid PRIMARY KEY, collection_code text, title text);
      CREATE TABLE letters (id uuid PRIMARY KEY, collection_id uuid, date_raw text, type_sequence int, type letter_type DEFAULT 'L',
        visibility text DEFAULT 'PUBLISHED', metadata_published boolean DEFAULT true, transcript_published boolean DEFAULT true,
        transcript_status text DEFAULT 'VERIFIED', extra_content_status text DEFAULT 'VERIFIED', photo_description_status text DEFAULT 'VERIFIED', metadata_content_status text DEFAULT 'VERIFIED',
        sender text, recipient text, location_written text, hook text, summary text, tags text[], primary_topics text[], emotional_tone text, sender_recipient_relationship text,
        photo_description text, extra_content_transcript text, transcription_text text, created_at timestamptz DEFAULT '2020-01-01');
      CREATE TABLE letter_pages (id uuid PRIMARY KEY, letter_id uuid, page_number int DEFAULT 1, storage_path text, original_filename text,
        checksum_sha256 text, line_segments jsonb, segment_trust_state text DEFAULT 'unverified', width int, height int, created_at timestamptz, updated_at timestamptz);`);
    const collection = '10000000-0000-0000-0000-000000000001';
    await client`INSERT INTO collections VALUES (${collection}, '999', 'Synthetic benchmark')`;
    for (let index = 0; index < 24; index++) {
      await client`INSERT INTO letters (id,collection_id,date_raw,type_sequence,transcription_text,sender,recipient) VALUES
        (${letterId(index)},${collection},'19300101',${index + 1},${'A needle in a synthetic archive about family, travel, and home. '.repeat(8)},${`Sender ${index}`},${`Recipient ${index}`})`;
      await client`INSERT INTO letter_pages (id,letter_id,storage_path,original_filename,checksum_sha256) VALUES
        (${pageId(index)},${letterId(index)},${path.join(directory, `${index}.jpg`)},${`${index}.jpg`},${hash(source)})`;
    }
    const results = [];
    const repetitions = Number(argument('repetitions') ?? 5);
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const modes = ['before', '1', '2', '3']; modes.push(...modes.splice(0, repetition % modes.length));
      for (const mode of modes) for (const burst of [6, 24]) for (const encoding of ['br', 'gzip']) {
        const config = { mode, burst, encoding, repetition, baselineRoot: path.resolve(baselineRoot), database, directory };
        const output = await new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), `--child=${JSON.stringify(config)}`], { cwd: path.join(root, 'backend'), stdio: ['ignore', 'pipe', 'pipe'] });
          let stdout = ''; let stderr = '';
          child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
          child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr || stdout)));
        });
        results.push(output);
        process.stderr.write(`completed repetition${repetition + 1} mode${mode} burst${burst} ${encoding}\n`);
      }
    }
    assert.equal(new Set(results.map((result) => result.searchPayloadHash)).size, 1, 'search output differs between configurations');
    assert.equal(new Set(results.map((result) => result.imageHash)).size, 1, 'image output differs between configurations');
    console.log(JSON.stringify({ sourceBytes: source.length, results }, null, 2));
  } finally {
    await client?.end();
    if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' });
    await rm(directory, { recursive: true, force: true });
  }
}
