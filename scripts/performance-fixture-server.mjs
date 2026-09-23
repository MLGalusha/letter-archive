// Local, anonymous, GET-only replay for paired production-build measurements.
// The first upstream response is saved; both builds then receive identical data.
// Never use for authenticated workflows. No writes reach the production API.
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = resolve('output/performance');
const cache = resolve(root, 'responses');
await mkdir(cache, { recursive: true });
const pending = new Map();
let fetched = 0;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
async function replay(path, accept) {
  const key = createHash('sha256').update(path + accept).digest('hex');
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    try { return JSON.parse(await readFile(resolve(cache, key + '.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (++fetched > 250) throw new Error('Fixture fetch limit reached');
    const url = new URL(path, 'https://api.voicesthatremain.com');
    if (url.origin !== 'https://api.voicesthatremain.com') throw new Error('Unexpected upstream');
    const response = await fetch(url, { headers: { accept }, redirect: 'error' });
    const result = { path, accept, status: response.status, type: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()).toString('base64') };
    await writeFile(resolve(cache, key + '.json'), JSON.stringify(result));
    return result;
  })();
  pending.set(key, promise);
  return promise;
}
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.writeHead(204).end(); return; }
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  try {
    const result = await replay(req.url, req.headers.accept ?? '*/*');
    let body = Buffer.from(result.body, 'base64');
    res.setHeader('Content-Type', result.type ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Timing-Allow-Origin', '*');
    if (result.type?.includes('json')) { body = gzipSync(body); res.setHeader('Content-Encoding', 'gzip'); }
    res.writeHead(result.status).end(body);
  } catch (error) { res.writeHead(502).end(String(error)); }
}).listen(4310, '127.0.0.1');

for (const [name, port] of [['baseline', 4311], ['candidate', 4312]]) {
  const directory = resolve(root, name);
  http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const path = pathname.includes('.') ? resolve(directory, '.' + pathname) : resolve(directory, 'index.html');
      if (!path.startsWith(directory + '/')) { res.writeHead(403).end(); return; }
      const raw = await readFile(path);
      const type = mime[extname(path)] ?? 'application/octet-stream';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      const compress = /javascript|css|html|json|svg/.test(type);
      if (compress) res.setHeader('Content-Encoding', 'gzip');
      res.end(compress ? gzipSync(raw) : raw);
    } catch { res.writeHead(404).end(); }
  }).listen(port, '127.0.0.1');
}
console.log('Frozen public fixture API :4310; baseline :4311; candidate :4312');
