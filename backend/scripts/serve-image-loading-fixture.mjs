/** Loopback-only actual-route fixture for #123. Never accepts a database URL.
 * Build frontend with VITE_API_URL=https://127.0.0.1:54434, then from backend:
 * node --import tsx scripts/serve-image-loading-fixture.mjs /absolute/new-output-directory
 * Owns its disposable database/files/TLS certificate; Ctrl-C cleans them up.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, appendFile, rm, access } from 'node:fs/promises';
import http from 'node:http';
import http2 from 'node:http2';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import postgres from 'postgres';
import sharp from 'sharp';
import express from 'express';
import compression from 'compression';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const root = fileURLToPath(new URL('../..', import.meta.url));
if (process.argv[2] === '--worker') {
  await serve(JSON.parse(process.argv[3]));
  process.exit(process.exitCode ?? 0);
}
const output = process.argv[2];
assert.ok(output && path.isAbsolute(output), 'Supply a new absolute output directory');
const uid = (kind, index) => `${kind}0000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let container, containerName, client, database, worker, temp;
const stop = shutdownSignal();
try {
  await access(path.join(root, 'frontend/dist/index.html'));
  await mkdir(output); // Never overwrite a previous measurement.
  temp = await mkdtemp(path.join(os.tmpdir(), 'archive-visible-images-'));
  stop.check();
  containerName = `archive-visible-${randomUUID()}`;
  container = execFileSync('docker', ['run', '--name', containerName, '--rm', '-d', '-e', 'POSTGRES_PASSWORD=fixture', '-e', 'POSTGRES_DB=archive_fixture', '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { encoding: 'utf8' }).trim();
  await writeFile(path.join(output, 'owned-resources.json'), JSON.stringify({ containerName, temp }));
  stop.check();
  const binding = execFileSync('docker', ['port', container, '5432'], { encoding: 'utf8' }).trim();
  const databaseUrl = `postgresql://postgres:fixture@${binding}/archive_fixture`;
  assert.match(databaseUrl, /^postgresql:\/\/postgres:fixture@127\.0\.0\.1:\d+\/archive_fixture$/);
  process.env.DATABASE_URL = databaseUrl;
  process.env.STORAGE_DIR = temp;
  process.env.LOG_LEVEL = 'silent';
  process.env.NODE_ENV = 'test';
  process.env.OPENAI_API_KEY = '';
  client = postgres(databaseUrl, { max: 1 });
  for (let n = 0; ; n++) {
    stop.check();
    try { await client`SELECT 1`; break; }
    catch (error) { if (n === 30) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  await migrate(drizzle(client), { migrationsFolder: path.join(root, 'backend/src/db/migrations') });
  stop.check();
  database = await import('../src/db/index.ts');
  const sources = [];
  // Three deterministic document-like rasters, no private scans or external downloads.
  for (const [index, [width, height]] of [[1600, 2200], [2400, 3200], [3200, 2400]].entries()) {
    stop.check();
    const pixels = Buffer.alloc(width * height * 3);
    let seed = 12345 + index;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const ink = x > width * .1 && x < width * .87 && y > height * .1 && y < height * .9 && y % 47 < 7 && x % 29 < 23;
      const shade = (ink ? 50 : 220) + (seed >>> 28);
      const offset = (y * width + x) * 3;
      pixels[offset] = shade; pixels[offset + 1] = shade - 9; pixels[offset + 2] = shade - 22;
    }
    const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    const file = path.join(temp, `source-${index}.jpg`);
    await writeFile(file, bytes);
    sources.push({ width, height, file, bytes: bytes.length, sha256: digest(bytes) });
  }
  await database.db.insert(database.collections).values([
    { id: uid('1', 0), collectionCode: '003', title: 'Controlled archive — 35 cards' },
    { id: uid('1', 1), collectionCode: '009', title: 'Controlled archive — 13 cards' },
  ]);
  for (let index = 0; index < 48; index++) {
    stop.check();
    const source = sources[index % sources.length];
    const storagePath = path.join(temp, `page-${index}.jpg`);
    await copyFile(source.file, storagePath);
    await database.db.insert(database.letters).values({
      id: uid('3', index), collectionId: uid('1', index < 35 ? 0 : 1), dateRaw: new Date(Date.UTC(1930, 0, index + 1)).toISOString().slice(0, 10).replaceAll('-', ''),
      type: 'L', typeSequence: 1, visibility: 'PUBLISHED', transcriptPublished: true, metadataPublished: true,
      transcriptStatus: 'VERIFIED', metadataContentStatus: 'VERIFIED',
      transcriptionText: `${index % 8 === 0 ? 'needle ' : ''}${'A family letter about travel and home. '.repeat(30)}`,
      sender: `Sender ${index}`, recipient: 'Molly', hook: `Synthetic letter ${index + 1}`,
      createdAt: new Date(Date.UTC(2020, 0, 1, 0, index)),
    });
    await database.db.insert(database.letterPages).values({
      id: uid('2', index), letterId: uid('3', index), pageNumber: 1, storagePath,
      originalFilename: `page-${index}.jpg`, checksumSha256: source.sha256, width: source.width, height: source.height,
    });
  }
  await database.db.insert(database.siteSettings).values({ key: 'featured_letter_id', value: uid('3', 35) });
  await database.db.insert(database.contentPages).values({ slug: 'home', title: 'Controlled image experiment', contentJson: {} });
  await client.unsafe('ANALYZE collections; ANALYZE letters; ANALYZE letter_pages');
  const manifest = {
    frontendHash: digest(await readFile(path.join(root, 'frontend/dist/index.html'))), cards: 48, collection003: 35,
    featuredPageId: uid('2', 35),
    sources: sources.map(({ file, ...source }) => source), node: process.version, sharp: sharp.versions,
    logicalCpus: os.cpus().length, transport: 'local TLS HTTP/2 gateway → HTTP/1 actual Express routes',
    cache: 'Owned source directory at startup; restart retains its durable files and DB, clears worker memory', started: new Date().toISOString() };
  // Same source paths, mtimes, database and frontend across backend comparisons.
  // Input: "restart" or "use /absolute/backend-checkout"; no shared config changes.
  let appRoot = root;
  async function launch() {
    stop.check();
    assert.ok(path.isAbsolute(appRoot));
    await access(path.join(appRoot, 'backend/src/routes/images.ts'));
    assert.equal(digest(await readFile(path.join(appRoot, 'backend/package-lock.json'))), digest(await readFile(path.join(root, 'backend/package-lock.json'))), 'Comparison dependency lock differs');
    worker = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--worker',
      JSON.stringify({ appRoot, frontendRoot: root, output, temp, databaseUrl, manifest })], {
      cwd: path.join(root, 'backend'), stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`Fixture worker exited before ready: ${code}`)));
    });
  }
  async function stopWorker() {
    if (!worker || worker.exitCode !== null) return;
    const exited = new Promise(resolve => worker.once('exit', resolve));
    worker.kill('SIGTERM'); await exited;
  }
  await launch();
  const commands = createInterface({ input: process.stdin });
  let transitions = Promise.resolve();
  commands.on('line', line => {
    transitions = transitions.then(async () => {
      stop.check();
      if (line !== 'restart' && !line.startsWith('use /')) return;
      await stopWorker();
      if (line.startsWith('use ')) appRoot = line.slice(4);
      await launch();
    }).catch(error => { console.error(error); process.kill(process.pid, 'SIGTERM'); });
  });
  console.log('Commands: restart (fresh worker, same durable files), use /absolute/checkout, Ctrl-C (cleanup).');
  await stop.promise;
  commands.close(); await transitions; await stopWorker();
} finally {
  await cleanup([
    async () => {
      if (!worker || worker.exitCode !== null) return;
      const exited = new Promise(resolve => worker.once('exit', resolve));
      worker.kill('SIGTERM'); await exited;
    },
    () => database?.closeDatabase(), () => client?.end(),
    () => { if (containerName) execFileSync('docker', ['stop', containerName], { stdio: 'ignore' }); },
    () => temp && rm(temp, { recursive: true, force: true }),
  ]);
  stop.dispose();
}

async function serve({ appRoot, frontendRoot, output, temp, databaseUrl, manifest: initialManifest }) {
  const stop = shutdownSignal();
  let database, api, gateway, apiGateway;
  let logWrites = Promise.resolve();
  const sessions = new Set();
  try {
  assert.match(databaseUrl, /^postgresql:\/\/postgres:fixture@127\.0\.0\.1:\d+\/archive_fixture$/);
  process.env.DATABASE_URL = databaseUrl; process.env.STORAGE_DIR = temp;
  process.env.LOG_LEVEL = 'silent'; process.env.NODE_ENV = 'test'; process.env.OPENAI_API_KEY = '';
  database = await import(path.join(appRoot, 'backend/src/db/index.ts'));
  stop.check();
  const manifest = { ...initialManifest, appRoot, workerPid: process.pid, workerStarted: new Date().toISOString(),
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(),
    imageRouteHash: createHash('sha256').update(await readFile(path.join(appRoot, 'backend/src/routes/images.ts'))).digest('hex'),
    backendLockHash: createHash('sha256').update(await readFile(path.join(appRoot, 'backend/package-lock.json'))).digest('hex') };
  const app = express();
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://127.0.0.1:54433');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
    // Isolate the fixture from external font/CDN traffic without response interception.
    // Both compared builds use the same fallback fonts; this is not a typography audit.
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self' https://127.0.0.1:54434; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://127.0.0.1:54434; font-src 'self'; script-src 'self' 'unsafe-inline'");
    const row = { id: randomUUID(), workerPid: process.pid, url: req.url, startedEpochMs: Date.now(), started: performance.now() };
    res.setHeader('x-request-id', row.id);
    req.requestId = row.id;
    req.log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (fields, message) => {
      if (message === 'Image response completed' || message === 'Image response abandoned') Object.assign(row, fields);
      if (message === 'Archive search completed') { row.queryMs = fields.duration; row.beforeSend = performance.now(); }
    }]));
    const record = () => {
      row.status = res.statusCode; row.aborted = !res.writableFinished; row.finished = performance.now();
      logWrites = logWrites.then(() => appendFile(path.join(output, 'server.jsonl'), JSON.stringify(row) + '\n'));
    };
    // Route finish listeners populate phase fields before this queued callback.
    res.once('close', () => queueMicrotask(record));
    next();
  });
  app.use(compression({ filter: (req, res) => !req.path.startsWith('/api/images/') && compression.filter(req, res) }));
  for (const route of ['images', 'letters', 'collections', 'content-pages', 'updates']) {
    app.use('/api', (await import(path.join(appRoot, `backend/src/routes/${route}.ts`))).default);
  }
  // The seed contains no public settings; auxiliary header/footer configuration is empty.
  app.get('/api/settings/public', (_req, res) => res.json({}));
  app.get('/__benchmark', (_req, res) => res.json(manifest));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Fixture does not mount this public route' }));
  app.use(express.static(path.join(frontendRoot, 'frontend/dist')));
  app.get('*', (_req, res) => res.sendFile(path.join(frontendRoot, 'frontend/dist/index.html')));
  app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: String(error) }); });
  api = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { api.once('listening', resolve); api.once('error', reject); });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', path.join(temp, 'key.pem'), '-out', path.join(temp, 'cert.pem')], { stdio: 'ignore' });
  const credentials = { key: await readFile(path.join(temp, 'key.pem')), cert: await readFile(path.join(temp, 'cert.pem')) };
  const proxyStream = (prefix) => (stream, headers) => {
    const forwarded = Object.fromEntries(Object.entries(headers).filter(([name]) => !name.startsWith(':')));
    const upstream = http.request({ hostname: '127.0.0.1', port: api.address().port, path: prefix + headers[':path'], method: headers[':method'], headers: forwarded }, response => {
      if (stream.destroyed) { response.destroy(); return; }
      const responseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !['connection', 'transfer-encoding', 'keep-alive', 'upgrade'].includes(name)));
      stream.respond({ ':status': response.statusCode, ...responseHeaders });
      response.pipe(stream);
    });
    upstream.on('error', () => { if (!stream.destroyed) stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR); });
    stream.on('error', () => upstream.destroy());
    stream.on('aborted', () => upstream.destroy());
    stream.pipe(upstream);
  };
  gateway = http2.createSecureServer(credentials);
  apiGateway = http2.createSecureServer(credentials);
  for (const [server, port, prefix] of [[gateway, 54433, ''], [apiGateway, 54434, '/api']]) {
    stop.check();
    server.on('session', session => { sessions.add(session); session.once('close', () => sessions.delete(session)); });
    server.on('stream', proxyStream(prefix));
    server.listen(port, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  }
  manifest.base = 'https://127.0.0.1:54433';
  manifest.apiBase = 'https://127.0.0.1:54434';
  await writeFile(path.join(output, 'fixture.json'), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(output, `worker-${process.pid}.json`), JSON.stringify(manifest, null, 2));
  console.log(`Ready: ${manifest.base} (48 cards; local disposable database). Ctrl-C to clean up.`);
  process.send?.({ ready: true });
  await stop.promise;
  } finally {
    await cleanup([
      () => { for (const session of sessions) session.destroy(); },
      () => gateway?.close(), () => apiGateway?.close(),
      () => { api?.closeAllConnections(); api?.close(); },
      () => logWrites, () => database?.closeDatabase(),
    ]);
    stop.dispose();
  }
}

function shutdownSignal() {
  let requested = false, resolve;
  const promise = new Promise(done => { resolve = done; });
  const handler = () => { requested = true; resolve(); };
  process.on('SIGINT', handler); process.on('SIGTERM', handler);
  return { promise,
    check() { if (requested) throw new Error('Fixture interrupted; cleaning up owned resources'); },
    dispose() { process.off('SIGINT', handler); process.off('SIGTERM', handler); },
  };
}

async function cleanup(steps) {
  // One failed close must not skip the independently owned container/files.
  for (const step of steps) {
    try { await step(); }
    catch (error) { console.error('Fixture cleanup failed:', error); process.exitCode = 1; }
  }
}
