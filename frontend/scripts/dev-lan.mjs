// Dev server for mobile testing on a real phone over LAN.
//
// What it does:
// 1. Detects your Mac's LAN IP (en0 / en1 / first non-internal IPv4)
// 2. Figures out the backend URL by reading .env.local if present, falling
//    back to http://localhost:3002
// 3. Rewrites the backend host to the LAN IP and passes it as VITE_API_URL
// 4. Launches vite with --host so Vite binds to 0.0.0.0
// 5. Prints the URL to open on your phone
//
// Works in both the main worktree (backend 3002, frontend 5174) and in
// isolated worktrees that use different ports via .env.local / launch.json.
// The backend CORS config already allows any LAN origin in dev mode.

import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '..');
const envLocalPath = path.join(frontendDir, '.env.local');

function parseEnvFile(filepath) {
  if (!existsSync(filepath)) return {};
  const out = {};
  for (const line of readFileSync(filepath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const envLocal = parseEnvFile(envLocalPath);

// Backend URL: prefer .env.local VITE_API_URL, then process env, then default.
const rawApiUrl = envLocal.VITE_API_URL || process.env.VITE_API_URL || 'http://localhost:3002';

// Frontend port: prefer VITE_SITE_URL in .env.local (has the port), then default.
function extractPort(url, fallback) {
  try {
    const u = new URL(url);
    return u.port || fallback;
  } catch {
    return fallback;
  }
}
const FRONTEND_PORT = extractPort(envLocal.VITE_SITE_URL || '', '5174');

function pickLanIp() {
  const interfaces = networkInterfaces();
  // Prefer en0 (built-in Wi-Fi on Macs), then en1, then any non-internal IPv4.
  const priority = ['en0', 'en1'];
  for (const name of priority) {
    const addrs = interfaces[name] || [];
    const match = addrs.find((a) => a.family === 'IPv4' && !a.internal);
    if (match) return match.address;
  }
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name] || [];
    const match = addrs.find((a) => a.family === 'IPv4' && !a.internal);
    if (match) return match.address;
  }
  return null;
}

const lanIp = pickLanIp();
if (!lanIp) {
  console.error('[dev:lan] Could not detect a LAN IP. Are you on Wi-Fi?');
  process.exit(1);
}

const frontendUrl = `http://${lanIp}:${FRONTEND_PORT}/`;

// Rewrite backend URL host to the LAN IP (keep port + scheme).
let apiUrl;
try {
  const u = new URL(rawApiUrl);
  u.hostname = lanIp;
  apiUrl = u.toString().replace(/\/$/, '');
} catch {
  apiUrl = `http://${lanIp}:3002`;
}

console.log('');
console.log('  ┌─────────────────────────────────────────────────┐');
console.log('  │  LAN dev server — open on your phone:           │');
console.log(`  │    ${frontendUrl.padEnd(45)}│`);
console.log('  │                                                 │');
console.log(`  │  API: ${apiUrl.padEnd(42)}│`);
console.log('  │                                                 │');
console.log('  │  Make sure the backend is also running:         │');
console.log('  │    cd backend && npm run dev                    │');
console.log('  └─────────────────────────────────────────────────┘');
console.log('');

// Pass through any extra args after the script name (e.g. --port 5175).
// If the user didn't specify --port, bind Vite to the FRONTEND_PORT we just
// advertised in the phone URL — otherwise Vite falls back to its default
// (5173) and the printed LAN URL is unreachable in worktrees with custom
// ports.
const extraArgs = process.argv.slice(2);
const hasPortArg = extraArgs.some((a) => a === '--port' || a.startsWith('--port='));
const viteArgs = ['--host', '0.0.0.0'];
if (!hasPortArg) viteArgs.push('--port', String(FRONTEND_PORT));
viteArgs.push(...extraArgs);

const child = spawn(
  'vite',
  viteArgs,
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_API_URL: apiUrl,
    },
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
