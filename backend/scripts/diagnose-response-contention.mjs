// Local synthetic diagnostic; never imports the app, reads credentials, or contacts production.
// Run from backend: node scripts/diagnose-response-contention.mjs > response-contention.json
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import { createRequire } from 'node:module';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import express from 'express';
import compression from 'compression';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const round = (n) => Math.round(n * 100) / 100;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const payload = { letters: Array.from({ length: 24 }, (_, i) => ({
  id: `synthetic-${i}`, sender: `Sender ${i}`, recipient: `Recipient ${i}`,
  transcript: ('A reproducible synthetic archive letter about family, travel, and home. ').repeat(4),
})), page: 1, total: 94 };
const expected = Buffer.from(JSON.stringify(payload));

// Deterministic textured input, generated once outside measured phases. No archive data needed.
let seed = 12345;
const pixels = Buffer.alloc(2400 * 3200 * 3);
for (let i = 0; i < pixels.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  pixels[i] = seed >>> 24;
}
const source = await sharp(pixels, { raw: { width: 2400, height: 3200, channels: 3 } })
  .jpeg({ quality: 85 }).toBuffer();
const transform = () => sharp(source).rotate()
  .resize({ width: 480, fit: 'inside', withoutEnlargement: true })
  .avif({ quality: 60, effort: 2 }).toBuffer();
const prepared = await transform();

let active;
const app = express();
app.use(compression({ filter: (req, res) => {
  if (req.path.startsWith('/images/') || req.path.startsWith('/blog-images/')) return false;
  return compression.filter(req, res);
} }));
app.get('/letters/search', async (_req, res) => {
  const row = active;
  const start = performance.now();
  res.once('finish', () => {
    row.serverFinishMs = round(performance.now() - start);
    row.responseTailMs = round(performance.now() - row.beforeSend);
  });
  // Fixed query stand-in: deliberately excludes DB, filesystem, auth, and network storage.
  await delay(5);
  row.queryStandInMs = round(performance.now() - start);
  const serializationStart = performance.now();
  const body = JSON.stringify(payload);
  row.serializationMs = round(performance.now() - serializationStart);
  row.beforeSend = performance.now();
  row.sharpAtSend = sharp.counters();
  res.type('json').send(body);
});
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const port = server.address().port;
const results = [];
try {
  for (let repetition = 0; repetition < 3; repetition++) {
    // Rotate workload order to reduce systematic warm-up/order bias.
    const workloads = ['none', 'transforms', 'bounded-transforms', 'prepared'];
    workloads.push(...workloads.splice(0, repetition));
    for (const workload of workloads) {
      for (const encoding of ['br', 'gzip', 'identity']) {
        const row = { repetition, workload, encoding, maxSharpQueue: 0 };
        active = row;
        const eventLoop = monitorEventLoopDelay({ resolution: 5 });
        eventLoop.enable();
        await delay(15);
        const onQueue = (n) => { row.maxSharpQueue = Math.max(row.maxSharpQueue, n); };
        sharp.queue.on('change', onQueue);
        const cpuStart = process.cpuUsage();
        const wallStart = performance.now();
        const imageStart = performance.now();
        const images = workload === 'transforms'
          ? Promise.all(Array.from({ length: 6 }, transform))
          : workload === 'bounded-transforms'
          ? Promise.all(Array.from({ length: 2 }, async () => {
            for (let i = 0; i < 3; i++) await transform();
          }))
          : Promise.resolve(workload === 'prepared' ? Array(6).fill(prepared) : []);
        const imageFinished = images.then(() => { row.imageBatchMs = round(performance.now() - imageStart); });
        const requestStart = performance.now();
        await new Promise((resolve, reject) => {
          const req = http.get({ host: '127.0.0.1', port, path: '/letters/search',
            headers: { 'Accept-Encoding': encoding }, agent: false }, (res) => {
            row.ttfbMs = round(performance.now() - requestStart);
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () => {
              try {
                assert.equal(res.statusCode, 200);
                const body = Buffer.concat(chunks);
                row.contentEncoding = res.headers['content-encoding'] ?? 'identity';
                assert.equal(row.contentEncoding, encoding);
                row.wireBytes = body.length;
                const decoded = encoding === 'br' ? brotliDecompressSync(body)
                  : encoding === 'gzip' ? gunzipSync(body) : body;
                assert.deepEqual(decoded, expected);
                row.clientTotalMs = round(performance.now() - requestStart);
                resolve();
              } catch (error) { reject(error); }
            });
          });
          req.setTimeout(30000, () => req.destroy(new Error('Local request timed out')));
          req.on('error', reject);
        });
        await imageFinished;
        const cpu = process.cpuUsage(cpuStart);
        row.batchWallMs = round(performance.now() - wallStart);
        row.processCpuMs = round((cpu.user + cpu.system) / 1000);
        row.eventLoopMaxMs = round(eventLoop.max / 1e6);
        row.eventLoopMeanMs = round(eventLoop.mean / 1e6);
        eventLoop.disable();
        sharp.queue.off('change', onQueue);
        delete row.beforeSend;
        results.push(row);
      }
    }
  }
  console.log(JSON.stringify({ environment: {
    node: process.version, platform: process.platform, arch: process.arch,
    cpuCount: os.cpus().length, uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? 'default (4)',
    express: require('express/package.json').version, compression: require('compression/package.json').version,
    sharp: sharp.versions, sharpConcurrency: sharp.concurrency(),
    sourceBytes: source.length, preparedBytes: prepared.length, payloadBytes: expected.length,
  }, results }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
