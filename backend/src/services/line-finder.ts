import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';
import type { LineSegment } from './kraken.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger({ module: 'line-finder' });

interface LineFinderResult {
  line: number;
  top_y: number;
  bottom_y: number;
  left_x: number;
  right_x: number;
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
      timeout: 60_000,
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
    }));

    log.info({ imagePath, lineCount: segments.length }, 'Line finder completed');
    return segments;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.warn({ imagePath, err: message }, 'Line finder failed (non-fatal)');
    return null;
  }
}
