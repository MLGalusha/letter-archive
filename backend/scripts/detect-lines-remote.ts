/**
 * Kraken Line Detection CLI
 *
 * Interactive terminal tool that fetches pages needing line segments from
 * the hosted API, runs Kraken locally, and uploads results.
 *
 * Usage:
 *   npm run detect-lines -- --url https://voicesthatremain.com --email admin@example.com --password secret
 *
 * Or with env vars:
 *   REMOTE_URL=https://voicesthatremain.com ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run detect-lines
 *
 * Controls (while running):
 *   p = pause/resume
 *   s = stop (after current page)
 *   q = quit immediately
 *   h = show history summary
 */

import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[++i];
    }
  }
  return {
    url: (flags.url || process.env.REMOTE_URL || '').replace(/\/$/, ''),
    email: flags.email || process.env.ADMIN_EMAIL || '',
    password: flags.password || process.env.ADMIN_PASSWORD || '',
  };
}

const config = parseArgs();

if (!config.url || !config.email || !config.password) {
  console.error('Usage: npm run detect-lines -- --url <API_URL> --email <EMAIL> --password <PASSWORD>');
  console.error('  Or set REMOTE_URL, ADMIN_EMAIL, ADMIN_PASSWORD env vars.');
  process.exit(1);
}

// Python paths
const venvPath = path.resolve(__dirname, '..', 'python', 'venv');
const pythonBin = path.join(venvPath, 'bin', 'python3');
const scriptPath = path.resolve(__dirname, '..', 'python', 'line_finder.py');

if (!fs.existsSync(pythonBin)) {
  console.error(`Python venv not found at ${venvPath}`);
  console.error('Run: cd backend && bash python/setup.sh');
  process.exit(1);
}

// History file
const HISTORY_DIR = path.join(os.homedir(), '.letter-archive');
const HISTORY_FILE = path.join(HISTORY_DIR, 'line-detection-history.json');

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

const CLEAR_LINE = '\x1b[2K\r';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';

function write(text: string) {
  process.stdout.write(text);
}

function writeln(text: string = '') {
  process.stdout.write(text + '\n');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function spinner(frame: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return frames[frame % frames.length];
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

interface HistoryEntry {
  pageId: string;
  letterId: string;
  dateRaw: string;
  pageNumber: number;
  status: 'success' | 'failed';
  linesDetected: number;
  downloadMs: number;
  detectMs: number;
  uploadMs: number;
  totalMs: number;
  error?: string;
  timestamp: string;
}

interface HistoryFile {
  runs: RunSummary[];
  entries: HistoryEntry[];
}

interface RunSummary {
  startedAt: string;
  completedAt: string;
  target: string;
  totalPages: number;
  succeeded: number;
  failed: number;
  totalMs: number;
}

function loadHistory(): HistoryFile {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { runs: [], entries: [] };
}

function saveHistory(history: HistoryFile) {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
  // Keep last 500 entries and 50 runs
  history.entries = history.entries.slice(-500);
  history.runs = history.runs.slice(-50);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function printHistorySummary(history: HistoryFile) {
  writeln(`\n${BOLD}Processing History${RESET}`);
  writeln(`${DIM}Stored at: ${HISTORY_FILE}${RESET}`);

  if (history.runs.length === 0) {
    writeln(`${DIM}No previous runs.${RESET}\n`);
    return;
  }

  const last5 = history.runs.slice(-5).reverse();
  writeln(`\n${DIM}Last ${last5.length} run(s):${RESET}`);
  for (const run of last5) {
    const status = run.failed > 0
      ? `${GREEN}${run.succeeded} ok${RESET} ${RED}${run.failed} failed${RESET}`
      : `${GREEN}${run.succeeded} ok${RESET}`;
    writeln(`  ${DIM}${formatDate(run.startedAt)}${RESET}  ${run.totalPages} pages  ${status}  ${DIM}${formatMs(run.totalMs)}${RESET}`);
  }

  // Recent failures
  const recentFails = history.entries.filter(e => e.status === 'failed').slice(-5);
  if (recentFails.length > 0) {
    writeln(`\n${RED}Recent failures:${RESET}`);
    for (const f of recentFails) {
      writeln(`  ${DIM}${f.dateRaw} p${f.pageNumber}${RESET} — ${f.error || 'unknown error'}`);
    }
  }
  writeln('');
}

// ---------------------------------------------------------------------------
// Remote API helpers
// ---------------------------------------------------------------------------

let token = '';

async function api(method: string, endpoint: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${config.url}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${endpoint} -> ${res.status}: ${text}`);
  }

  return res.json();
}

async function login() {
  const result = await api('POST', '/auth/login', {
    email: config.email,
    password: config.password,
  }) as { token: string };
  token = result.token;
}

interface QueuePage {
  pageId: string;
  letterId: string;
  pageNumber: number;
  dateRaw: string;
}

async function fetchQueue(): Promise<{ pages: QueuePage[]; total: number }> {
  return api('GET', '/admin/processing/line-detection-queue') as Promise<{ pages: QueuePage[]; total: number }>;
}

async function downloadImage(pageId: string, destPath: string): Promise<void> {
  const res = await fetch(`${config.url}/images/${pageId}?token=${token}`);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

interface LineFinderResult {
  line: number;
  top_y: number;
  bottom_y: number;
  left_x: number;
  right_x: number;
  boundary?: { x: number; y: number }[];
}

interface LineSegment {
  line: number;
  baseline: number[][];
  bbox: [number, number, number, number];
  ocrText: string;
  boundary?: { x: number; y: number }[];
}

async function runKraken(imagePath: string): Promise<LineSegment[]> {
  const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, imagePath, '--json'], {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (stderr) {
    const trimmed = stderr.trim();
    if (trimmed && !trimmed.includes('UserWarning')) {
      // Log to history, don't clutter UI
    }
  }

  const results: LineFinderResult[] = JSON.parse(stdout);
  return results.map((r) => ({
    line: r.line,
    baseline: [[r.left_x, r.bottom_y], [r.right_x, r.bottom_y]],
    bbox: [r.left_x, r.top_y, r.right_x, r.bottom_y] as [number, number, number, number],
    ocrText: '',
    boundary: r.boundary,
  }));
}

async function uploadSegments(pageId: string, lineSegments: LineSegment[]): Promise<void> {
  await api('PATCH', `/admin/letters/pages/${pageId}/line-segments`, { lineSegments });
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

type ProcessState = 'idle' | 'running' | 'paused' | 'stopping';

let processState: ProcessState = 'idle';
let spinnerFrame = 0;
let spinnerInterval: ReturnType<typeof setInterval> | null = null;

function startSpinner(label: string) {
  spinnerFrame = 0;
  stopSpinner();
  spinnerInterval = setInterval(() => {
    write(`${CLEAR_LINE}  ${CYAN}${spinner(spinnerFrame++)}${RESET} ${label}`);
  }, 80);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    write(CLEAR_LINE);
  }
}

async function processPages() {
  const history = loadHistory();
  const runStart = Date.now();
  const runStartIso = new Date().toISOString();
  let succeeded = 0;
  let failed = 0;

  processState = 'running';

  try {
    write(`${CYAN}Authenticating...${RESET}`);
    await login();
    writeln(`${CLEAR_LINE}${GREEN}Authenticated.${RESET}`);

    write(`${CYAN}Fetching queue...${RESET}`);
    const { pages, total } = await fetchQueue();
    writeln(`${CLEAR_LINE}${BOLD}${total}${RESET} pages need line detection.\n`);

    if (total === 0) {
      processState = 'idle';
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kraken-'));

    try {
      for (let i = 0; i < pages.length; i++) {
        // Check state
        if (processState === 'stopping') {
          writeln(`\n${YELLOW}Stopped by user.${RESET}`);
          break;
        }

        // Handle pause
        while (processState === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (processState === 'stopping') {
          writeln(`\n${YELLOW}Stopped by user.${RESET}`);
          break;
        }

        const page = pages[i];
        const label = `${page.dateRaw} p${page.pageNumber}`;
        const counter = `${DIM}[${i + 1}/${total}]${RESET}`;
        const tmpFile = path.join(tmpDir, `${page.pageId}.jpg`);
        const pageStart = Date.now();

        try {
          // Download
          startSpinner(`${counter} ${label} — downloading`);
          const dlStart = Date.now();
          await downloadImage(page.pageId, tmpFile);
          const dlMs = Date.now() - dlStart;
          const fileSizeKb = Math.round(fs.statSync(tmpFile).size / 1024);

          // Detect
          stopSpinner();
          startSpinner(`${counter} ${label} — detecting lines (${fileSizeKb}KB image)`);
          const detectStart = Date.now();
          const segments = await runKraken(tmpFile);
          const detectMs = Date.now() - detectStart;

          // Upload
          stopSpinner();
          startSpinner(`${counter} ${label} — uploading ${segments.length} lines`);
          const uploadStart = Date.now();
          await uploadSegments(page.pageId, segments);
          const uploadMs = Date.now() - uploadStart;

          stopSpinner();
          const totalMs = Date.now() - pageStart;
          succeeded++;

          writeln(
            `  ${GREEN}\u2713${RESET} ${counter} ${BOLD}${label}${RESET}` +
            `  ${segments.length} lines` +
            `  ${DIM}dl:${formatMs(dlMs)} det:${formatMs(detectMs)} up:${formatMs(uploadMs)} total:${formatMs(totalMs)}${RESET}`
          );

          history.entries.push({
            pageId: page.pageId,
            letterId: page.letterId,
            dateRaw: page.dateRaw,
            pageNumber: page.pageNumber,
            status: 'success',
            linesDetected: segments.length,
            downloadMs: dlMs,
            detectMs: detectMs,
            uploadMs: uploadMs,
            totalMs: totalMs,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          stopSpinner();
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          writeln(`  ${RED}\u2717${RESET} ${counter} ${BOLD}${label}${RESET}  ${RED}${msg.slice(0, 120)}${RESET}`);

          history.entries.push({
            pageId: page.pageId,
            letterId: page.letterId,
            dateRaw: page.dateRaw,
            pageNumber: page.pageNumber,
            status: 'failed',
            linesDetected: 0,
            downloadMs: 0,
            detectMs: 0,
            uploadMs: 0,
            totalMs: Date.now() - pageStart,
            error: msg,
            timestamp: new Date().toISOString(),
          });
        } finally {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        }
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Run summary
    const totalMs = Date.now() - runStart;
    history.runs.push({
      startedAt: runStartIso,
      completedAt: new Date().toISOString(),
      target: config.url,
      totalPages: succeeded + failed,
      succeeded,
      failed,
      totalMs,
    });
    saveHistory(history);

    writeln('');
    writeln(`${BOLD}Run complete${RESET}`);
    writeln(`  ${GREEN}${succeeded} succeeded${RESET}${failed > 0 ? `  ${RED}${failed} failed${RESET}` : ''}`);
    writeln(`  Total time: ${formatMs(totalMs)}`);

    if (succeeded > 0) {
      const avgMs = Math.round(
        history.entries
          .filter(e => e.status === 'success')
          .slice(-succeeded)
          .reduce((sum, e) => sum + e.detectMs, 0) / succeeded
      );
      writeln(`  Avg detection: ${formatMs(avgMs)}/page`);
    }
    writeln('');
  } catch (err) {
    stopSpinner();
    const msg = err instanceof Error ? err.message : String(err);
    writeln(`\n${RED}Fatal error: ${msg}${RESET}\n`);
  } finally {
    processState = 'idle';
  }
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

function setupKeyboard() {
  if (!process.stdin.isTTY) return;

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  process.stdin.on('keypress', (_str, key) => {
    if (!key) return;

    // Ctrl+C always quits
    if (key.ctrl && key.name === 'c') {
      stopSpinner();
      writeln(`\n${DIM}Bye.${RESET}`);
      process.exit(0);
    }

    switch (key.name) {
      case 'p':
        if (processState === 'running') {
          processState = 'paused';
          stopSpinner();
          writeln(`\n${YELLOW}Paused.${RESET} Press ${BOLD}p${RESET} to resume, ${BOLD}s${RESET} to stop.`);
        } else if (processState === 'paused') {
          processState = 'running';
          writeln(`${GREEN}Resumed.${RESET}`);
        }
        break;

      case 's':
        if (processState === 'running' || processState === 'paused') {
          processState = 'stopping';
          writeln(`\n${YELLOW}Stopping after current page...${RESET}`);
        }
        break;

      case 'q':
        stopSpinner();
        writeln(`\n${DIM}Bye.${RESET}`);
        process.exit(0);
        break;

      case 'h':
        if (processState === 'idle' || processState === 'paused') {
          printHistorySummary(loadHistory());
        }
        break;
    }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  writeln('');
  writeln(`${BOLD}Kraken Line Detection${RESET}`);
  writeln(`${DIM}Target: ${config.url}${RESET}`);
  writeln(`${DIM}History: ${HISTORY_FILE}${RESET}`);
  writeln('');

  // Show previous history
  const history = loadHistory();
  if (history.runs.length > 0) {
    const last = history.runs[history.runs.length - 1];
    writeln(`${DIM}Last run: ${formatDate(last.startedAt)} — ${last.totalPages} pages, ${last.succeeded} ok${last.failed > 0 ? `, ${last.failed} failed` : ''}${RESET}`);
    writeln('');
  }

  writeln(`${DIM}Controls: ${BOLD}p${RESET}${DIM}=pause  ${BOLD}s${RESET}${DIM}=stop  ${BOLD}q${RESET}${DIM}=quit  ${BOLD}h${RESET}${DIM}=history${RESET}`);
  writeln('');

  setupKeyboard();
  await processPages();

  writeln(`${DIM}Press ${BOLD}q${RESET}${DIM} to quit or ${BOLD}Ctrl+C${RESET}${DIM} to exit.${RESET}`);

  // Keep alive for keyboard input
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
