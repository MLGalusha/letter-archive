/**
 * One-off script: reset all line_segments to NULL in the cloud database.
 * Only affects pages where workflow != 'UPLOADED'.
 * Does NOT touch images, transcripts, metadata, or anything else.
 *
 * Usage: npx tsx scripts/reset-line-segments.ts
 */

import 'dotenv/config';

const REMOTE_URL = process.env.REMOTE_URL!;
const EMAIL = process.env.ADMIN_EMAIL!;
const PASSWORD = process.env.ADMIN_PASSWORD!;

async function main() {
  // Login
  const loginRes = await fetch(`${REMOTE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const { token } = (await loginRes.json()) as { token: string };
  console.log('Authenticated.');

  // Check current queue
  const queueBefore = await fetch(`${REMOTE_URL}/admin/processing/line-detection-queue`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json()) as { total: number };
  console.log(`Pages currently needing detection: ${queueBefore.total}`);
  console.log('All other non-UPLOADED pages have segments that will be cleared.\n');

  // Call reset endpoint
  console.log('Resetting line_segments to NULL...');
  const res = await fetch(`${REMOTE_URL}/admin/processing/reset-line-segments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    console.error(`Failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }

  const result = (await res.json()) as { reset: number };
  console.log(`Done. Reset ${result.reset} pages.\n`);

  // Verify
  const queueAfter = await fetch(`${REMOTE_URL}/admin/processing/line-detection-queue`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json()) as { total: number };
  console.log(`Pages now needing detection: ${queueAfter.total}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
