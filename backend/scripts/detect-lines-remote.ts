/**
 * Kraken Native Layout Detection CLI
 *
 * Interactive terminal tool that fetches pages needing native layout from the
 * hosted API, runs Kraken locally, and uploads provider-preserving results.
 *
 * Usage:
 *   npm run detect-lines -- --url https://voicesthatremain.com --email admin@example.com --password secret --limit 5
 *   npm run detect-lines -- --url https://voicesthatremain.com --email admin@example.com --password secret --page-id <PAGE_ID>
 *   npm run detect-lines -- --url https://voicesthatremain.com --email admin@example.com --password secret --page-id <PAGE_ID> --rotations 0,90,270
 *   npm run detect-lines -- --url https://voicesthatremain.com --email admin@example.com --password secret --dry-run
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
import { randomUUID } from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { pageLayoutChecksumSchema } from '../src/schemas/page-layout-v2.js';
import {
  krakenNativePageLayoutV2Schema,
  type KrakenNativePageLayoutV2,
} from '../src/services/kraken-page-layout-adapter.js';
import {
  isUnboundedDetectionRun,
  parseDetectLinesCliOptions,
  type DetectLinesCliOptions,
} from '../src/services/detect-lines-cli-options.js';
import { KrakenNativeWorker } from '../src/services/kraken-native-worker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

let config: ReturnType<typeof parseDetectLinesCliOptions>;

const detectorRunId = `run-${randomUUID()}`;

// Python paths
const venvPath = path.resolve(__dirname, '..', 'python', 'venv');
const pythonBin = path.join(venvPath, 'bin', 'python3');
const scriptPath = path.resolve(__dirname, '..', 'python', 'line_finder.py');

function initializeRuntimeConfig(): boolean {
  try {
    config = parseDetectLinesCliOptions(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Use --limit <N>, --page-id <PAGE_ID>, or --dry-run to bound or inspect a run.');
    process.exitCode = 1;
    return false;
  }

  if (!config.url || !config.email || !config.password) {
    console.error('Usage: npm run detect-lines -- --url <API_URL> --email <EMAIL> --password <PASSWORD> [--limit <N> | --page-id <PAGE_ID> | --dry-run] [--rotations 0,90,270]');
    console.error('  Or set REMOTE_URL, ADMIN_EMAIL, ADMIN_PASSWORD env vars.');
    process.exitCode = 1;
    return false;
  }

  if (!fs.existsSync(pythonBin)) {
    console.error(`Python venv not found at ${venvPath}`);
    console.error('Run: cd backend && bash python/setup.sh');
    process.exitCode = 1;
    return false;
  }

  return true;
}

// History file
const HISTORY_DIR = path.join(os.homedir(), '.letter-archive');
const HISTORY_FILE = path.join(HISTORY_DIR, 'line-detection-history.json');
const DEBUG_DIR = path.join(HISTORY_DIR, 'debug');

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
  candidatesProposed?: number;
  proposalStatus?: RotationProposalUploadResponse['status'];
  proposalId?: string;
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
  runId?: string;
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
let imageSessionCookie = '';

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
  const response = await fetch(`${config.url}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: config.email,
      password: config.password,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API POST /auth/login -> ${response.status}: ${text}`);
  }
  const result = await response.json() as { token: string };
  token = result.token;

  // Hidden archive images intentionally accept only the purpose-scoped image
  // session cookie, not the API bearer token or a token in the query string.
  // Node fetch has no cookie jar, so carry the login cookie explicitly.
  const setCookie = response.headers.get('set-cookie');
  imageSessionCookie = setCookie?.split(';', 1)[0] ?? '';
  if (!imageSessionCookie) {
    throw new Error('Login did not establish the required image session');
  }
}

export interface QueuePage {
  pageId: string;
  letterId: string;
  pageNumber: number;
  dateRaw: string;
  primarySourceRevision: number;
  sourceChecksum: string;
  geometryRevision?: number;
  geometryChecksumSha256?: string;
  lineSegmentsChecksumSha256?: string;
}

export interface RotationQueuePage extends QueuePage {
  geometryRevision: number;
  geometryChecksumSha256: string;
  lineSegmentsChecksumSha256: string;
}

export interface RotationQueueResponse {
  pages: RotationQueuePage[];
  total: number;
}

const rotationQueuePageSchema = z.object({
  pageId: z.string().uuid(),
  letterId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  dateRaw: z.string().trim().min(1).max(128),
  primarySourceRevision: z.number().int().nonnegative(),
  sourceChecksum: pageLayoutChecksumSchema,
  geometryRevision: z.number().int().nonnegative(),
  geometryChecksumSha256: pageLayoutChecksumSchema,
  lineSegmentsChecksumSha256: pageLayoutChecksumSchema,
}).strict();

const rotationQueueResponseSchema = z.object({
  pages: z.array(rotationQueuePageSchema),
  total: z.number().int().nonnegative(),
}).strict().superRefine((response, context) => {
  if (response.total < response.pages.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['total'],
      message: 'Queue total cannot be smaller than the returned page count',
    });
  }

  const pageIds = new Set<string>();
  response.pages.forEach((page, index) => {
    if (pageIds.has(page.pageId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages', index, 'pageId'],
        message: `Rotation queue contains duplicate page ${page.pageId}`,
      });
    }
    pageIds.add(page.pageId);
  });
});

export function parseRotationQueueResponse(
  value: unknown,
): RotationQueueResponse {
  const parsed = rotationQueueResponseSchema.safeParse(value);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const location = firstIssue?.path.length
      ? ` at ${firstIssue.path.join('.')}`
      : '';
    throw new Error(
      `Rotation queue endpoint returned an invalid response${location}`,
    );
  }
  return parsed.data;
}

type DetectionMode = Pick<DetectLinesCliOptions, 'rotationsDegrees'>;
type DetectionQueueOptions = Pick<
  DetectLinesCliOptions,
  'rotationsDegrees' | 'limit' | 'pageId'
>;

export function isRotationProposalMode(
  options: DetectionMode,
): boolean {
  return options.rotationsDegrees !== undefined;
}

export function queueEndpointForDetection(
  options: DetectionQueueOptions,
): string {
  if (!isRotationProposalMode(options)) {
    return '/admin/layout-processing/queue';
  }

  const search = new URLSearchParams();
  if (options.pageId !== undefined) {
    search.set('pageId', options.pageId);
  }
  if (options.limit !== undefined) {
    search.set('limit', String(options.limit));
  }
  const query = search.toString();
  return `/admin/layout-processing/rotation-queue${
    query ? `?${query}` : ''
  }`;
}

async function fetchQueue(): Promise<{ pages: QueuePage[]; total: number }> {
  const response = await api('GET', queueEndpointForDetection(config));
  if (isRotationProposalMode(config)) {
    return parseRotationQueueResponse(response);
  }
  return response as {
    pages: QueuePage[];
    total: number;
  };
}

function selectQueuePages(pages: QueuePage[]): QueuePage[] {
  let selected = pages;
  if (config.pageId) {
    selected = selected.filter((page) => page.pageId === config.pageId);
    if (selected.length === 0) {
      const eligibility = isRotationProposalMode(config)
        ? 'a sideways-text recovery proposal'
        : 'native layout detection';
      throw new Error(`Page ${config.pageId} is not eligible for ${eligibility}`);
    }
  }
  if (config.limit !== undefined) {
    selected = selected.slice(0, config.limit);
  }
  return selected;
}

async function confirmUnboundedRun(pageCount: number): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    writeln(
      `${RED}Refusing an unbounded non-interactive run.${RESET} `
      + 'Pass --limit <N> or --page-id <PAGE_ID>.',
    );
    process.exitCode = 2;
    return false;
  }

  const expected = `process ${pageCount}`;
  const writeDescription = isRotationProposalMode(config)
    ? `create sideways-text recovery proposals for ${pageCount} pages`
    : `write native layout for ${pageCount} pages`;
  const prompt = (
    `${YELLOW}This unbounded run can ${writeDescription}.${RESET}\n`
    + `Type ${BOLD}${expected}${RESET} to continue: `
  );
  const answer = await new Promise<string>((resolve) => {
    const question = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    question.question(prompt, (response) => {
      question.close();
      resolve(response);
    });
  });

  if (answer.trim() !== expected) {
    writeln(`${DIM}Confirmation did not match. Nothing was processed.${RESET}`);
    return false;
  }
  return true;
}

async function downloadImage(pageId: string, destPath: string): Promise<void> {
  const res = await fetch(`${config.url}/images/${pageId}`, {
    headers: { Cookie: imageSessionCookie },
  });
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

interface DebugExtent {
  line: number;
  bbox: [number, number, number, number];
}

async function runKraken(
  worker: KrakenNativeWorker,
  imagePath: string,
): Promise<KrakenNativePageLayoutV2> {
  return krakenNativePageLayoutV2Schema.parse(
    await worker.detect(
      imagePath,
      'horizontal-lr',
      config.rotationsDegrees,
    ),
  );
}

export interface DetectionUploadRequest {
  method: 'PATCH';
  endpoint: string;
  body: {
    nativePageLayout: KrakenNativePageLayoutV2;
    runId: string;
    primarySourceRevision?: number;
    sourceChecksum?: string;
    source?: {
      primarySourceRevision: number;
      sourceChecksumSha256: string;
      baseGeometryRevision: number;
      baseGeometryChecksumSha256: string;
      baseLineSegmentsChecksumSha256: string;
    };
  };
}

export type RotationProposalUploadResponse =
  | {
    ok: true;
    status: 'saved' | 'already-exists';
    candidateCount: number;
    proposalId: string;
    artifactChecksumSha256: string;
    createdAt: string;
  }
  | {
    ok: true;
    status: 'no-candidates';
    candidateCount: 0;
  };

const rotationProposalUploadResponseSchema = z.discriminatedUnion('status', [
  z.object({
    ok: z.literal(true),
    status: z.enum(['saved', 'already-exists']),
    candidateCount: z.number().int().positive(),
    proposalId: z.string().uuid(),
    artifactChecksumSha256: pageLayoutChecksumSchema,
    createdAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    ok: z.literal(true),
    status: z.literal('no-candidates'),
    candidateCount: z.literal(0),
  }).strict(),
]);

export function parseRotationProposalUploadResponse(
  value: unknown,
): RotationProposalUploadResponse {
  const parsed = rotationProposalUploadResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Rotation proposal endpoint returned an invalid response');
  }
  return parsed.data;
}

function requireRotationFence(
  page: QueuePage,
  field:
    | 'geometryRevision'
    | 'geometryChecksumSha256'
    | 'lineSegmentsChecksumSha256',
): number | string {
  const value = page[field];
  if (value === undefined) {
    throw new Error(
      `Rotation queue page ${page.pageId} is missing required ${field}`,
    );
  }
  return value;
}

export function buildDetectionUploadRequest(
  page: QueuePage,
  nativePageLayout: KrakenNativePageLayoutV2,
  runId: string,
  options: DetectionMode,
): DetectionUploadRequest {
  if (isRotationProposalMode(options)) {
    return {
      method: 'PATCH',
      endpoint:
        `/admin/letters/pages/${page.pageId}/geometry-proposals/rotation`,
      body: {
        nativePageLayout,
        runId,
        source: {
          primarySourceRevision: page.primarySourceRevision,
          sourceChecksumSha256: page.sourceChecksum,
          baseGeometryRevision: requireRotationFence(
            page,
            'geometryRevision',
          ) as number,
          baseGeometryChecksumSha256: requireRotationFence(
            page,
            'geometryChecksumSha256',
          ) as string,
          baseLineSegmentsChecksumSha256: requireRotationFence(
            page,
            'lineSegmentsChecksumSha256',
          ) as string,
        },
      },
    };
  }

  return {
    method: 'PATCH',
    endpoint: `/admin/letters/pages/${page.pageId}/page-layout/kraken`,
    body: {
      nativePageLayout,
      runId,
      primarySourceRevision: page.primarySourceRevision,
      sourceChecksum: page.sourceChecksum,
    },
  };
}

async function uploadDetectionResult(
  page: QueuePage,
  nativePageLayout: KrakenNativePageLayoutV2,
): Promise<
  | { mode: 'native-layout' }
  | {
    mode: 'rotation-proposal';
    response: RotationProposalUploadResponse;
  }
> {
  const request = buildDetectionUploadRequest(
    page,
    nativePageLayout,
    detectorRunId,
    config,
  );
  const response = await api(
    request.method,
    request.endpoint,
    request.body,
  );
  if (!isRotationProposalMode(config)) {
    return { mode: 'native-layout' };
  }
  return {
    mode: 'rotation-proposal',
    response: parseRotationProposalUploadResponse(response),
  };
}

function debugExtents(layout: KrakenNativePageLayoutV2): DebugExtent[] {
  return layout.segmentation.lines.flatMap((line, index) => (
    line.displayExtent.bbox
      ? [{
        line: index + 1,
        bbox: line.displayExtent.bbox,
      }]
      : []
  ));
}

async function saveDebugImage(
  imagePath: string,
  extents: DebugExtent[],
  label: string,
): Promise<string> {
  const sharp = (await import('sharp')).default;
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const w = meta.width || 800;
  const h = meta.height || 1200;

  // Build SVG overlay with colored bounding boxes and line numbers
  const colors = ['#ff3333', '#33cc33', '#3366ff', '#ff9900', '#cc33ff', '#00cccc', '#ff6699', '#99cc00'];
  const rects = extents.map((extent, i) => {
    const [x1, y1, x2, y2] = extent.bbox;
    const color = colors[i % colors.length];
    return `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="none" stroke="${color}" stroke-width="3" opacity="0.8"/>` +
      `<text x="${x1 + 4}" y="${y1 + 16}" font-size="14" font-weight="bold" fill="${color}" font-family="sans-serif">${extent.line}</text>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rects}</svg>`;

  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const outPath = path.join(DEBUG_DIR, `${label}.jpg`);

  await img
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toFile(outPath);

  return outPath;
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

type ProcessState = 'idle' | 'running' | 'paused' | 'stopping';

let processState: ProcessState = 'idle';
let activeKrakenWorker: KrakenNativeWorker | null = null;
let spinnerFrame = 0;
let spinnerInterval: ReturnType<typeof setInterval> | null = null;

function currentProcessState(): ProcessState {
  // Keyboard events mutate processState between awaits. Reading through a
  // function prevents TypeScript from incorrectly treating the initial
  // "running" assignment as immutable for the whole async loop.
  return processState;
}

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

async function processPages(): Promise<boolean> {
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
    const queue = await fetchQueue();
    const pages = selectQueuePages(queue.pages);
    const total = pages.length;
    const queueDescription = isRotationProposalMode(config)
      ? 'pages are eligible for sideways-text recovery proposals'
      : 'pages need line detection';
    writeln(
      `${CLEAR_LINE}${BOLD}${queue.total}${RESET} ${queueDescription}; `
      + `${BOLD}${total}${RESET} selected.\n`,
    );

    if (total === 0) {
      processState = 'idle';
      return false;
    }

    if (config.dryRun) {
      const uploadDescription = isRotationProposalMode(config)
        ? 'no proposals will be created'
        : 'no layouts will be uploaded';
      writeln(
        `${BOLD}Dry run — no images will be downloaded and `
        + `${uploadDescription}.${RESET}`,
      );
      for (const page of pages) {
        writeln(`  ${page.pageId}  ${page.dateRaw} p${page.pageNumber}`);
      }
      writeln('');
      return false;
    }

    if (
      isUnboundedDetectionRun(config)
      && !(await confirmUnboundedRun(total))
    ) {
      return false;
    }

    setupKeyboard();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kraken-'));

    try {
      startSpinner('Loading Kraken 7 model once for this run');
      activeKrakenWorker = await KrakenNativeWorker.start({
        executablePath: pythonBin,
        scriptPath,
        startupTimeoutMs: 120_000,
        requestTimeoutMs: config.rotationsDegrees ? 420_000 : 120_000,
        shutdownTimeoutMs: 10_000,
      });
      stopSpinner();
      writeln(`${GREEN}Kraken 7 worker ready.${RESET}`);

      for (let i = 0; i < pages.length; i++) {
        // Check state
        if (currentProcessState() === 'stopping') {
          writeln(`\n${YELLOW}Stopped by user.${RESET}`);
          break;
        }

        // Handle pause
        while (currentProcessState() === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (currentProcessState() === 'stopping') {
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
          const nativePageLayout = await runKraken(
            activeKrakenWorker,
            tmpFile,
          );
          const lineCount = nativePageLayout.segmentation.lines.length;
          const detectMs = Date.now() - detectStart;

          // Upload
          stopSpinner();
          const uploadLabel = isRotationProposalMode(config)
            ? `submitting recovery proposal (${lineCount} detected lines)`
            : `uploading ${lineCount} lines`;
          startSpinner(`${counter} ${label} — ${uploadLabel}`);
          const uploadStart = Date.now();
          const uploadResult = await uploadDetectionResult(
            page,
            nativePageLayout,
          );
          const uploadMs = Date.now() - uploadStart;

          // Debug overlays use provider display extents only. They do not
          // manufacture or mutate canonical line geometry.
          let debugPath: string | undefined;
          const extents = debugExtents(nativePageLayout);
          if (config.debug && extents.length > 0) {
            stopSpinner();
            startSpinner(`${counter} ${label} — saving debug image`);
            debugPath = await saveDebugImage(
              tmpFile,
              extents,
              `${page.dateRaw}-p${page.pageNumber}`,
            );
          }

          stopSpinner();
          const totalMs = Date.now() - pageStart;
          succeeded++;
          const proposalResponse = uploadResult.mode
            === 'rotation-proposal'
            ? uploadResult.response
            : undefined;
          const resultDescription = proposalResponse
            ? (
                proposalResponse.status === 'no-candidates'
                  ? '0 sideways candidates'
                  : `${proposalResponse.candidateCount} sideways candidates · `
                    + proposalResponse.status.replace('-', ' ')
              )
            : `${lineCount} lines`;

          writeln(
            `  ${GREEN}\u2713${RESET} ${counter} ${BOLD}${label}${RESET}` +
            `  ${resultDescription}` +
            `  ${DIM}dl:${formatMs(dlMs)} det:${formatMs(detectMs)} up:${formatMs(uploadMs)} total:${formatMs(totalMs)}${RESET}` +
            (proposalResponse?.proposalId
              ? `\n    ${DIM}proposal: ${proposalResponse.proposalId}${RESET}`
              : '') +
            (debugPath ? `\n    ${DIM}debug: ${debugPath}${RESET}` : '')
          );

          history.entries.push({
            pageId: page.pageId,
            letterId: page.letterId,
            dateRaw: page.dateRaw,
            pageNumber: page.pageNumber,
            status: 'success',
            linesDetected: lineCount,
            ...(proposalResponse
              ? {
                  candidatesProposed:
                    proposalResponse.candidateCount,
                  proposalStatus: proposalResponse.status,
                  ...(proposalResponse.proposalId
                    ? { proposalId: proposalResponse.proposalId }
                    : {}),
                }
              : {}),
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
      try {
        if (activeKrakenWorker) {
          await activeKrakenWorker.close();
          activeKrakenWorker = null;
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    // Run summary
    const totalMs = Date.now() - runStart;
    history.runs.push({
      runId: detectorRunId,
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
    if (failed > 0) {
      process.exitCode = 1;
    }
    writeln('');
    return true;
  } catch (err) {
    stopSpinner();
    const msg = err instanceof Error ? err.message : String(err);
    writeln(`\n${RED}Fatal error: ${msg}${RESET}\n`);
    process.exitCode = 1;
    return false;
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
      activeKrakenWorker?.abort();
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
        activeKrakenWorker?.abort();
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
  if (!initializeRuntimeConfig()) return;

  writeln('');
  writeln(
    `${BOLD}${
      isRotationProposalMode(config)
        ? 'Kraken Sideways-Text Recovery Proposals'
        : 'Kraken Native Layout Detection'
    }${RESET}`,
  );
  writeln(`${DIM}Target: ${config.url}${RESET}`);
  writeln(`${DIM}Run: ${detectorRunId}${RESET}`);
  writeln(`${DIM}History: ${HISTORY_FILE}${RESET}`);
  writeln(
    `${DIM}Detection profile: ${
      config.rotationsDegrees
        ? 'rotated-region recovery (0°, 90°, 270°)'
        : 'standard single pass (0°)'
    }${RESET}`,
  );
  if (config.debug) writeln(`${YELLOW}Debug mode: saving overlay images to ${DEBUG_DIR}${RESET}`);
  if (config.dryRun) writeln(`${YELLOW}Dry-run mode: read-only queue inspection${RESET}`);
  if (config.pageId) writeln(`${DIM}Page: ${config.pageId}${RESET}`);
  if (config.limit !== undefined) writeln(`${DIM}Limit: ${config.limit}${RESET}`);
  writeln('');

  // Show previous history
  const history = loadHistory();
  if (history.runs.length > 0) {
    const last = history.runs[history.runs.length - 1];
    writeln(`${DIM}Last run: ${formatDate(last.startedAt)} — ${last.totalPages} pages, ${last.succeeded} ok${last.failed > 0 ? `, ${last.failed} failed` : ''}${RESET}`);
    writeln('');
  }

  if (process.stdin.isTTY && !config.dryRun) {
    writeln(`${DIM}Controls: ${BOLD}p${RESET}${DIM}=pause  ${BOLD}s${RESET}${DIM}=stop  ${BOLD}q${RESET}${DIM}=quit  ${BOLD}h${RESET}${DIM}=history${RESET}`);
    writeln('');
  }

  const keepOpen = await processPages();

  if (keepOpen && process.stdin.isTTY) {
    writeln(`${DIM}Press ${BOLD}q${RESET}${DIM} to quit or ${BOLD}Ctrl+C${RESET}${DIM} to exit.${RESET}`);
    // Keep the completed interactive session open so the history shortcut
    // remains available. Non-interactive and dry-run invocations always exit.
    await new Promise(() => {});
  }
}

const isDirectExecution = (
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
);

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
