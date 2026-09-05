import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFrontendRelease, cacheDescription } from './image-benchmark-metadata.mjs';

const revision = 'a'.repeat(40);
test('accepts only a successful version response containing a revision', async () => {
  const fetcher = async () => new Response(JSON.stringify({ releaseSha: revision }));
  assert.deepEqual(await readFrontendRelease('https://example.test', { required: true, fetcher }), { releaseSha: revision });
});

for (const [name, fetcher] of [
  ['transport error', async () => { throw new Error('Timed out'); }],
  ['HTTP failure', async () => new Response('{}', { status: 503 })],
  ['missing revision', async () => new Response('{}')],
  ['malformed revision', async () => new Response('{"releaseSha":"unknown"}')],
]) {
  test(`production aborts on ${name}; optional local/substituted lookup may be unavailable`, async () => {
    await assert.rejects(readFrontendRelease('https://example.test', { required: true, fetcher }), /Cannot verify production revision/);
    assert.equal(await readFrontendRelease('http://localhost', { required: false, fetcher }), null);
  });
}

test('method metadata distinguishes a fresh context from subsequent cached visits', () => {
  assert.match(cacheDescription(false), /fresh browser context per run/);
  assert.match(cacheDescription(true), /first visit fresh, later visits reuse browser cache/);
  assert.doesNotMatch(cacheDescription(true), /fresh browser context per run/);
});
