/**
 * Letter Archive Admin CLI
 *
 * Interactive terminal tool for managing the hosted site.
 *
 * Usage:
 *   npm run admin
 *
 * Reads REMOTE_URL, ADMIN_EMAIL, ADMIN_PASSWORD from .env
 */

import 'dotenv/config';
import { execFileSync } from 'child_process';
import readline from 'readline';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REMOTE_URL = (process.env.REMOTE_URL || '').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!REMOTE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Missing env vars: REMOTE_URL, ADMIN_EMAIL, ADMIN_PASSWORD');
  console.error('Set them in backend/.env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';

function write(text: string) {
  process.stdout.write(text);
}

function writeln(text: string = '') {
  process.stdout.write(text + '\n');
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function padRight(str: string, width: number): string {
  const len = stripAnsi(str).length;
  return str + ' '.repeat(Math.max(0, width - len));
}

function padLeft(str: string, width: number): string {
  const len = stripAnsi(str).length;
  return ' '.repeat(Math.max(0, width - len)) + str;
}

function table(headers: string[], rows: string[][]) {
  const colWidths = headers.map((h, i) => {
    const dataMax = rows.reduce((max, row) => Math.max(max, stripAnsi(row[i] || '').length), 0);
    return Math.max(stripAnsi(h).length, dataMax);
  });

  writeln('  ' + headers.map((h, i) => padRight(`${BOLD}${h}${RESET}`, colWidths[i] + BOLD.length + RESET.length)).join('  '));
  writeln('  ' + colWidths.map(w => '─'.repeat(w)).join('──'));
  for (const row of rows) {
    writeln('  ' + row.map((cell, i) => padRight(cell || '', colWidths[i])).join('  '));
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'UPLOADED': return DIM;
    case 'TRANSCRIBING': case 'METADATA_EXTRACTING': return CYAN;
    case 'TRANSCRIBED': case 'METADATA_DRAFTED': return YELLOW;
    case 'REVIEWED': return GREEN;
    case 'PUBLISHED': return GREEN;
    case 'HIDDEN': return DIM;
    case 'SUCCESS': case 'success': return GREEN;
    case 'FAILED': case 'failed': case 'FAILURE': return RED;
    case 'RUNNING': case 'PENDING': return CYAN;
    default: return '';
  }
}

function colorStatus(status: string): string {
  return `${statusColor(status)}${status}${RESET}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;

function startSpinner(msg: string) {
  spinnerFrame = 0;
  spinnerInterval = setInterval(() => {
    write(`\x1b[2K\r  ${CYAN}${SPINNER_FRAMES[spinnerFrame++ % SPINNER_FRAMES.length]}${RESET} ${msg}`);
  }, 80);
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
    write('\x1b[2K\r');
  }
}

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

let rl: readline.Interface;

function initReadline() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function confirm(msg: string): Promise<boolean> {
  const answer = await ask(`  ${YELLOW}${msg}${RESET} ${DIM}(y/N)${RESET} `);
  return answer.trim().toLowerCase() === 'y';
}

async function confirmDestructive(msg: string): Promise<boolean> {
  writeln(`  ${RED}${BOLD}${msg}${RESET}`);
  const answer = await ask(`  ${RED}Type YES to confirm:${RESET} `);
  return answer.trim() === 'YES';
}

async function promptInput(label: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? ` ${DIM}(${defaultVal})${RESET}` : '';
  const answer = await ask(`  ${label}${suffix}: `);
  return answer.trim() || defaultVal || '';
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

let token = '';

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${REMOTE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Auto re-auth on 401
  if (res.status === 401 && token) {
    await login();
    headers['Authorization'] = `Bearer ${token}`;
    const retry = await fetch(`${REMOTE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!retry.ok) {
      const text = await retry.text().catch(() => '');
      throw new Error(`${method} ${path} → ${retry.status}: ${text}`);
    }
    return retry.json() as T;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }

  return res.json() as T;
}

async function login() {
  const result = await api<{ token: string }>('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  token = result.token;
}

// ---------------------------------------------------------------------------
// Menu types
// ---------------------------------------------------------------------------

interface MenuItem {
  key: string;
  label: string;
  description: string;
  handler: () => Promise<void>;
}

interface MenuCategory {
  key: string;
  title: string;
  description: string;
  items: MenuItem[];
}

// ---------------------------------------------------------------------------
// Command handlers — Processing
// ---------------------------------------------------------------------------

async function handleQueueStatus() {
  startSpinner('Fetching queue status...');
  try {
    const q = await api<{
      active: { letterId: string; type: string; startedAt: string }[];
      queued: {
        transcription: { letterId: string; queuedAt: string }[];
        metadata: { letterId: string; queuedAt: string }[];
        entityExtraction: { letterId: string; queuedAt: string }[];
        extraContent: { letterId: string; queuedAt: string | null }[];
      };
      recent: {
        letterId: string;
        type: string;
        status: string;
        completedAt: string;
        error?: string;
      }[];
      counts: Record<string, number>;
    }>('GET', '/admin/processing/queue');
    stopSpinner();

    if (q.counts && Object.keys(q.counts).length > 0) {
      writeln(`\n  ${BOLD}Queue Counts${RESET}`);
      for (const [key, val] of Object.entries(q.counts)) {
        writeln(`    ${key}: ${val}`);
      }
    }

    if (q.active?.length) {
      writeln(`\n  ${BOLD}Active Jobs${RESET}`);
      for (const job of q.active) {
        writeln(`    ${CYAN}●${RESET} ${job.type} — ${DIM}${job.letterId}${RESET}`);
      }
    }

    const queued = [
      ...q.queued.transcription.map(job => ({ ...job, type: 'transcription' })),
      ...q.queued.metadata.map(job => ({ ...job, type: 'metadata' })),
      ...q.queued.entityExtraction.map(job => ({ ...job, type: 'entity extraction' })),
      ...q.queued.extraContent.map(job => ({ ...job, type: 'extra content' })),
    ];
    if (queued.length) {
      writeln(`\n  ${BOLD}Queued${RESET} ${DIM}(${queued.length} items)${RESET}`);
      for (const job of queued.slice(0, 10)) {
        writeln(`    ${DIM}○${RESET} ${job.type} — ${DIM}${job.letterId}${RESET}`);
      }
      if (queued.length > 10) writeln(`    ${DIM}... and ${queued.length - 10} more${RESET}`);
    }

    const recentFailed = q.recent.filter(job => job.status === 'FAILED');
    if (recentFailed.length) {
      writeln(`\n  ${RED}Recent Failures${RESET}`);
      for (const job of recentFailed.slice(0, 5)) {
        writeln(`    ${RED}✗${RESET} ${job.type} — ${DIM}${job.letterId}${RESET}`);
        if (job.error) writeln(`      ${DIM}${job.error}${RESET}`);
      }
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleWakeProcessingWorker() {
  startSpinner('Requesting processing worker...');
  try {
    const result = await api<
      | { requested: true }
      | {
          requested: false;
          reason: 'queue_empty' | 'worker_not_configured';
        }
    >('POST', '/admin/processing/wake');
    stopSpinner();
    if (result.requested === true) {
      writeln(`  ${GREEN}Worker requested${RESET}`);
    } else if (result.reason === 'queue_empty') {
      writeln(`  ${DIM}No durable queued work${RESET}`);
    } else {
      writeln(`  ${YELLOW}Cloud Run worker job is not configured${RESET}`);
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// Command handlers — Line Detection
// ---------------------------------------------------------------------------

async function handleLineDetectionQueue() {
  startSpinner('Fetching line detection queue...');
  try {
    const result = await api<{ pages: { pageId: string; letterId: string; pageNumber: number; dateRaw: string }[]; total: number }>(
      'GET', '/admin/processing/line-detection-queue'
    );
    stopSpinner();

    writeln(`\n  ${BOLD}${result.total}${RESET} pages need line detection\n`);

    if (result.pages.length > 0) {
      const rows = result.pages.slice(0, 20).map(p => [
        `${DIM}${p.pageId.slice(0, 8)}${RESET}`,
        p.dateRaw || '—',
        `p${p.pageNumber}`,
        `${DIM}${p.letterId.slice(0, 8)}${RESET}`,
      ]);
      table(['Page ID', 'Date', 'Page', 'Letter ID'], rows);
      if (result.total > 20) {
        writeln(`\n  ${DIM}Showing 20 of ${result.total}${RESET}`);
      }
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleResetLineSegments() {
  if (!await confirmDestructive('This will clear ALL line segments from letter-type pages.')) return;

  startSpinner('Resetting line segments...');
  try {
    const result = await api<{ reset: number }>('POST', '/admin/processing/reset-line-segments');
    stopSpinner();
    writeln(`  ${GREEN}Reset ${result.reset} pages${RESET}`);
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleRunLineDetection() {
  writeln(`\n  ${DIM}Launching detect-lines CLI (inherits this terminal)...${RESET}`);
  writeln(`  ${DIM}Press Ctrl+C to stop detection and return here.${RESET}\n`);

  rl.close();

  try {
    execFileSync(process.execPath, [
      '--import', 'tsx',
      'scripts/detect-lines-remote.ts',
      ...process.argv.slice(2),
    ], {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    });
  } catch {
    // User stopped with Ctrl+C or script exited — that's fine
  }

  initReadline();
}

// ---------------------------------------------------------------------------
// Command handlers — Letters
// ---------------------------------------------------------------------------

async function handleListLetters() {
  const collection = await promptInput('Collection code (enter to skip)');
  const workflow = await promptInput('Workflow filter (enter to skip)');
  const search = await promptInput('Search text (enter to skip)');
  const pageStr = await promptInput('Page', '1');
  const page = parseInt(pageStr) || 1;

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', '20');
  if (collection) params.set('collection', collection);
  if (workflow) params.set('workflow', workflow);
  if (search) params.set('search', search);

  startSpinner('Fetching letters...');
  try {
    const result = await api<{
      letters: {
        id: string;
        dateRaw: string;
        sender: string;
        recipient: string;
        collectionCode: string;
        workflowState: string;
        visibility: string;
      }[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>('GET', `/admin/letters?${params}`);
    stopSpinner();

    writeln(`\n  ${BOLD}${result.pagination.total}${RESET} letters found ${DIM}(page ${result.pagination.page}/${result.pagination.totalPages})${RESET}\n`);

    if (result.letters.length > 0) {
      const rows = result.letters.map(l => [
        l.dateRaw || '—',
        (l.sender || '—').slice(0, 20),
        (l.recipient || '—').slice(0, 20),
        l.collectionCode || '—',
        colorStatus(l.workflowState),
        colorStatus(l.visibility),
      ]);
      table(['Date', 'Sender', 'Recipient', 'Collection', 'Workflow', 'Visibility'], rows);
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleViewLetter() {
  const letterId = await promptInput('Letter ID');
  if (!letterId) return;

  startSpinner('Fetching letter...');
  try {
    const letter = await api<{
      id: string;
      dateRaw: string;
      sender: string;
      recipient: string;
      collectionCode: string;
      workflowState: string;
      visibility: string;
      transcript: { text: string | null; status: string };
      metadata: { summary: string | null; hook: string | null; status: string };
      images: { id: string; pageNumber: number; filename: string }[];
    }>('GET', `/admin/letters/${letterId}`);
    stopSpinner();

    writeln(`\n  ${BOLD}Letter Details${RESET}`);
    writeln(`  ID:          ${DIM}${letter.id}${RESET}`);
    writeln(`  Date:        ${letter.dateRaw || '—'}`);
    writeln(`  Sender:      ${letter.sender || '—'}`);
    writeln(`  Recipient:   ${letter.recipient || '—'}`);
    writeln(`  Collection:  ${letter.collectionCode || '—'}`);
    writeln(`  Workflow:    ${colorStatus(letter.workflowState)}`);
    writeln(`  Visibility:  ${colorStatus(letter.visibility)}`);
    writeln(`  Pages:       ${letter.images?.length || 0}`);

    if (letter.transcript?.status) {
      writeln(`  Transcript:  ${colorStatus(letter.transcript.status)}`);
    }
    if (letter.metadata?.status) {
      writeln(`  Metadata:    ${colorStatus(letter.metadata.status)}`);
    }
    if (letter.metadata?.summary) {
      writeln(`\n  ${BOLD}Summary${RESET}`);
      writeln(`  ${DIM}${letter.metadata.summary.slice(0, 200)}${letter.metadata.summary.length > 200 ? '...' : ''}${RESET}`);
    }
    if (letter.metadata?.hook) {
      writeln(`\n  ${BOLD}Hook${RESET}`);
      writeln(`  ${DIM}${letter.metadata.hook}${RESET}`);
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// Command handlers — Collections
// ---------------------------------------------------------------------------

async function handleListCollections() {
  startSpinner('Fetching collections...');
  try {
    const collections = await api<{
      collectionCode: string;
      title: string;
      letterCount: number;
      publishedCount: number;
      hiddenCount: number;
      dateRange: { earliest: string | null; latest: string | null };
      byWorkflow: Record<string, number>;
    }[]>('GET', '/admin/collections');
    stopSpinner();

    writeln(`\n  ${BOLD}${collections.length}${RESET} collections\n`);

    if (collections.length > 0) {
      const rows = collections.map(c => [
        `${BOLD}${c.collectionCode}${RESET}`,
        (c.title || '—').slice(0, 30),
        String(c.letterCount ?? 0),
        `${GREEN}${c.publishedCount ?? 0}${RESET}`,
        `${DIM}${c.hiddenCount ?? 0}${RESET}`,
        c.dateRange?.earliest && c.dateRange?.latest
          ? `${c.dateRange.earliest}–${c.dateRange.latest}`
          : '—',
      ]);
      table(['Code', 'Title', 'Total', 'Published', 'Hidden', 'Date Range'], rows);
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// Command handlers — Usage
// ---------------------------------------------------------------------------

async function handleUsageSummary() {
  const monthsStr = await promptInput('Months to show', '6');
  const months = parseInt(monthsStr) || 6;

  startSpinner('Fetching usage summary...');
  try {
    const result = await api<{
      months: {
        month: string;
        totalCalls: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        estimatedCost: string;
        byCallType: Record<string, { calls: number; inputTokens: number; outputTokens: number; estimatedCost: string }>;
      }[];
      totals: { totalCalls: number; totalInputTokens: number; totalOutputTokens: number; estimatedCost: string };
    }>('GET', `/admin/usage/summary?months=${months}`);
    stopSpinner();

    if (result.totals) {
      writeln(`\n  ${BOLD}All-time Totals${RESET}`);
      writeln(`  Calls:  ${result.totals.totalCalls}`);
      writeln(`  Tokens: ${result.totals.totalInputTokens.toLocaleString()} in / ${result.totals.totalOutputTokens.toLocaleString()} out`);
      writeln(`  Cost:   ${GREEN}$${result.totals.estimatedCost}${RESET}`);
    }

    if (result.months?.length) {
      writeln(`\n  ${BOLD}Monthly Breakdown${RESET}\n`);
      const rows = result.months.map(m => [
        m.month,
        String(m.totalCalls),
        m.totalInputTokens.toLocaleString(),
        m.totalOutputTokens.toLocaleString(),
        `${GREEN}$${m.estimatedCost}${RESET}`,
      ]);
      table(['Month', 'Calls', 'Input Tokens', 'Output Tokens', 'Cost'], rows);
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleUsageAnalytics() {
  startSpinner('Fetching analytics...');
  try {
    const result = await api<{
      byCallType: { callType: string; calls: number; estimatedCost: string }[];
      byModel: { model: string; calls: number; estimatedCost: string }[];
      byCollection: { collectionCode: string; calls: number; estimatedCost: string }[];
    }>('GET', '/admin/usage/analytics');
    stopSpinner();

    if (result.byCallType?.length) {
      writeln(`\n  ${BOLD}By Call Type${RESET}\n`);
      const rows = result.byCallType.map(r => [r.callType, String(r.calls), `${GREEN}$${r.estimatedCost}${RESET}`]);
      table(['Type', 'Calls', 'Cost'], rows);
    }

    if (result.byModel?.length) {
      writeln(`\n  ${BOLD}By Model${RESET}\n`);
      const rows = result.byModel.map(r => [r.model, String(r.calls), `${GREEN}$${r.estimatedCost}${RESET}`]);
      table(['Model', 'Calls', 'Cost'], rows);
    }

    if (result.byCollection?.length) {
      writeln(`\n  ${BOLD}By Collection${RESET}\n`);
      const rows = result.byCollection.map(r => [r.collectionCode || '—', String(r.calls), `${GREEN}$${r.estimatedCost}${RESET}`]);
      table(['Collection', 'Calls', 'Cost'], rows);
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// Command handlers — Bulk Operations
// ---------------------------------------------------------------------------

async function handleBulkTranscribe() {
  const ids = await promptInput('Letter IDs (comma-separated)');
  if (!ids) return;
  const letterIds = ids.split(',').map(s => s.trim()).filter(Boolean);

  writeln(`  Will transcribe ${BOLD}${letterIds.length}${RESET} letters`);
  if (!await confirm('Proceed?')) return;

  startSpinner('Queuing bulk transcription...');
  try {
    const result = await api<{ queued: number; skipped: number }>(
      'POST',
      '/admin/letters/bulk/transcribe',
      { letterIds },
    );
    stopSpinner();
    writeln(`  ${GREEN}${result.queued} queued${RESET}, ${result.skipped} skipped`);
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleBulkMetadata() {
  const ids = await promptInput('Letter IDs (comma-separated)');
  if (!ids) return;
  const letterIds = ids.split(',').map(s => s.trim()).filter(Boolean);

  writeln(`  Will extract metadata for ${BOLD}${letterIds.length}${RESET} letters`);
  if (!await confirm('Proceed?')) return;

  startSpinner('Queuing bulk metadata extraction...');
  try {
    const result = await api<{ queued: number; skipped: number; unconfirmedCount?: number }>(
      'POST',
      '/admin/letters/bulk/extract-metadata',
      { letterIds },
    );
    stopSpinner();
    writeln(`  ${GREEN}${result.queued} queued${RESET}, ${result.skipped} skipped`);
    if (result.unconfirmedCount) {
      writeln(`  ${YELLOW}${result.unconfirmedCount} transcript${result.unconfirmedCount === 1 ? '' : 's'} not confirmed${RESET}`);
    }
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleClearTranscriptions() {
  const ids = await promptInput('Letter IDs (comma-separated)');
  if (!ids) return;
  const letterIds = ids.split(',').map(s => s.trim()).filter(Boolean);

  if (!await confirmDestructive(`This will clear transcriptions for ${letterIds.length} letters.`)) return;

  startSpinner('Clearing transcriptions...');
  try {
    const result = await api<{ message: string; cleared: number }>('POST', '/admin/letters/bulk/clear-transcriptions', { letterIds });
    stopSpinner();
    writeln(`  ${GREEN}${result.message}${RESET} — ${result.cleared} cleared`);
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

async function handleClearMetadata() {
  const ids = await promptInput('Letter IDs (comma-separated)');
  if (!ids) return;
  const letterIds = ids.split(',').map(s => s.trim()).filter(Boolean);

  if (!await confirmDestructive(`This will clear metadata for ${letterIds.length} letters.`)) return;

  startSpinner('Clearing metadata...');
  try {
    const result = await api<{ message: string; cleared: number }>('POST', '/admin/letters/bulk/clear-metadata', { letterIds });
    stopSpinner();
    writeln(`  ${GREEN}${result.message}${RESET} — ${result.cleared} cleared`);
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Error: ${err instanceof Error ? err.message : String(err)}${RESET}`);
  }
}

// ---------------------------------------------------------------------------
// Menu definitions
// ---------------------------------------------------------------------------

const categories: MenuCategory[] = [
  {
    key: '1',
    title: 'Processing',
    description: 'Monitor durable jobs and request a global worker drain',
    items: [
      { key: '1', label: 'View queue', description: 'Active, queued, and recent jobs', handler: handleQueueStatus },
      { key: '2', label: 'Wake worker', description: 'Request a global durable-queue drain', handler: handleWakeProcessingWorker },
    ],
  },
  {
    key: '2',
    title: 'Line Detection',
    description: 'Queue info, reset segments, run Kraken',
    items: [
      { key: '1', label: 'View queue', description: 'Pages needing line detection', handler: handleLineDetectionQueue },
      { key: '2', label: 'Reset all segments', description: 'Clear all line segments (destructive)', handler: handleResetLineSegments },
      { key: '3', label: 'Run detection', description: 'Launch Kraken line detection CLI', handler: handleRunLineDetection },
    ],
  },
  {
    key: '3',
    title: 'Letters',
    description: 'Search & browse letter details',
    items: [
      { key: '1', label: 'List / search', description: 'Search letters with filters', handler: handleListLetters },
      { key: '2', label: 'View details', description: 'View a specific letter by ID', handler: handleViewLetter },
    ],
  },
  {
    key: '4',
    title: 'Collections',
    description: 'View collections with stats',
    items: [
      { key: '1', label: 'List all', description: 'All collections with counts and date ranges', handler: handleListCollections },
    ],
  },
  {
    key: '5',
    title: 'Usage',
    description: 'API costs & call history',
    items: [
      { key: '1', label: 'Monthly summary', description: 'Cost breakdown by month', handler: handleUsageSummary },
      { key: '2', label: 'Analytics', description: 'Breakdown by call type, model, and collection', handler: handleUsageAnalytics },
    ],
  },
  {
    key: '6',
    title: 'Bulk Operations',
    description: 'Batch transcribe, extract, or clear content',
    items: [
      { key: '1', label: 'Bulk transcribe', description: 'Transcribe multiple letters by ID', handler: handleBulkTranscribe },
      { key: '2', label: 'Bulk metadata', description: 'Extract metadata for multiple letters', handler: handleBulkMetadata },
      { key: '3', label: 'Clear transcriptions', description: 'Remove transcription content (destructive)', handler: handleClearTranscriptions },
      { key: '4', label: 'Clear metadata', description: 'Remove metadata content (destructive)', handler: handleClearMetadata },
    ],
  },
];

// ---------------------------------------------------------------------------
// Menu display and navigation
// ---------------------------------------------------------------------------

function displayMainMenu() {
  writeln(`\n${BOLD}  Letter Archive Admin CLI${RESET}`);
  writeln(`${DIM}  ${REMOTE_URL}${RESET}\n`);

  for (const cat of categories) {
    writeln(`  ${CYAN}${cat.key}${RESET}  ${padRight(cat.title, 18)} ${DIM}${cat.description}${RESET}`);
  }

  writeln(`\n  ${DIM}q${RESET}  Quit\n`);
}

function displayCategoryMenu(cat: MenuCategory) {
  writeln(`\n${BOLD}  ${cat.title}${RESET}\n`);

  for (const item of cat.items) {
    writeln(`  ${CYAN}${item.key}${RESET}  ${padRight(item.label, 22)} ${DIM}${item.description}${RESET}`);
  }

  writeln(`\n  ${DIM}b${RESET}  Back    ${DIM}q${RESET}  Quit\n`);
}

async function mainLoop() {
  let currentCategory: MenuCategory | null = null;

  while (true) {
    if (currentCategory) {
      displayCategoryMenu(currentCategory);
    } else {
      displayMainMenu();
    }

    const input = (await ask(`  ${CYAN}>${RESET} `)).trim().toLowerCase();

    if (input === 'q') {
      writeln(`\n${DIM}  Bye.${RESET}\n`);
      rl.close();
      process.exit(0);
    }

    if (input === 'b') {
      currentCategory = null;
      continue;
    }

    if (!currentCategory) {
      const cat = categories.find(c => c.key === input);
      if (cat) {
        currentCategory = cat;
      } else {
        writeln(`  ${RED}Unknown option: ${input}${RESET}`);
      }
    } else {
      const item = currentCategory.items.find(i => i.key === input);
      if (item) {
        await item.handler();
      } else {
        writeln(`  ${RED}Unknown option: ${input}${RESET}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  writeln('');
  writeln(`${BOLD}  Letter Archive Admin CLI${RESET}`);
  writeln(`${DIM}  ${REMOTE_URL}${RESET}`);
  writeln('');

  startSpinner('Authenticating...');
  try {
    await login();
    stopSpinner();
    writeln(`  ${GREEN}Authenticated as ${ADMIN_EMAIL}${RESET}`);
  } catch (err) {
    stopSpinner();
    writeln(`  ${RED}Authentication failed: ${err instanceof Error ? err.message : String(err)}${RESET}`);
    process.exit(1);
  }

  initReadline();
  await mainLoop();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
