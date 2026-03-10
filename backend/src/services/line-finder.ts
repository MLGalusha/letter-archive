import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { db, letterPages } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface LineSegment {
  line: number;
  baseline: number[][];
  bbox: [number, number, number, number];
  ocrText: string;
  words?: { text: string; bbox: [number, number, number, number] }[];
  boundary?: { x: number; y: number }[];
}

const log = createLogger({ module: 'line-finder' });

interface LineFinderWord {
  text: string;
  left_x: number;
  right_x: number;
  top_y: number;
  bottom_y: number;
}

interface LineFinderResult {
  line: number;
  top_y: number;
  bottom_y: number;
  left_x: number;
  right_x: number;
  words?: LineFinderWord[];
  boundary?: { x: number; y: number }[];
}

/**
 * Runs Python CV line finder on an image.
 * Uses horizontal projection profiling to detect handwritten line boundaries.
 * Returns an array of LineSegments, or null on failure (non-fatal).
 */
export async function runLineFinder(imagePath: string): Promise<LineSegment[] | null> {
  const venvPath = env.PYTHON_VENV_PATH;
  const pythonBin = path.join(venvPath, 'bin', 'python3');
  const scriptPath = path.resolve(__dirname, '../../python/line_finder.py');

  log.debug({ imagePath, pythonBin, scriptPath }, 'Running Python CV line finder');

  try {
    const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, imagePath, '--json'], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (stderr) {
      log.debug({ stderr: stderr.trim() }, 'line-finder stderr output');
    }

    const results: LineFinderResult[] = JSON.parse(stdout);

    if (!Array.isArray(results)) {
      log.warn('line-finder output is not an array');
      return null;
    }

    // Convert to LineSegment format, using Python-detected horizontal bounds
    const segments: LineSegment[] = results.map((r) => ({
      line: r.line,
      baseline: [[r.left_x, r.bottom_y], [r.right_x, r.bottom_y]],
      bbox: [r.left_x, r.top_y, r.right_x, r.bottom_y] as [number, number, number, number],
      ocrText: '',
      words: r.words?.map((w) => ({
        text: w.text,
        bbox: [w.left_x, w.top_y, w.right_x, w.bottom_y] as [number, number, number, number],
      })),
      boundary: r.boundary,
    }));

    log.info({ imagePath, lineCount: segments.length }, 'Line finder completed');
    return segments;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.warn({ imagePath, err: message }, 'Line finder failed (non-fatal)');
    return null;
  }
}

export async function savePageLineSegments(
  pageId: string,
  segments: LineSegment[],
): Promise<void> {
  await db.update(letterPages).set({
    lineSegments: segments,
    updatedAt: new Date(),
  }).where(eq(letterPages.id, pageId));
}

export type OnProgress = (label: string) => void;

export async function detectAndStorePageLines(
  pageId: string,
  imagePath: string,
  transcriptLines?: string[],
  onProgress?: OnProgress,
): Promise<{ lineSegments: LineSegment[] | null; ocrWordBoxes: import('./vision-ocr.js').OcrWordBox[] | null }> {
  // Run Kraken line detection and Vision OCR word detection in parallel
  onProgress?.('Detecting line positions');

  const visionPromise = import('./vision-ocr.js')
    .then(({ detectAndStorePageOcrWords }) => detectAndStorePageOcrWords(pageId, imagePath, onProgress))
    .catch(() => null as null);

  const [segments, ocrWordBoxes] = await Promise.all([
    runLineFinder(imagePath),
    visionPromise,
  ]);

  if (segments) {
    onProgress?.('Saving line segments');
    await savePageLineSegments(pageId, segments);
  }

  return { lineSegments: segments, ocrWordBoxes };
}

export async function detectAndStoreLinesForPages(
  pages: Array<{ id: string; storagePath: string; pageNumber: number }>,
  getAbsoluteStoragePath: (storagePath: string) => string,
): Promise<void> {
  for (const page of pages) {
    const absolutePath = getAbsoluteStoragePath(page.storagePath);
    const result = await detectAndStorePageLines(page.id, absolutePath);
    log.info(
      { pageId: page.id, pageNumber: page.pageNumber, lineCount: result.lineSegments?.length ?? 0 },
      'Stored line detection results for page',
    );
  }
}
