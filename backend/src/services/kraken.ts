import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import { env } from '../config/env.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger({ module: 'kraken' });

export interface LineSegment {
  line: number;
  baseline: number[][];
  bbox: [number, number, number, number];
  ocrText: string;
}

/**
 * Runs Kraken line segmentation on an image.
 * Returns an array of line segments with baselines, bounding boxes, and OCR text.
 * Returns null on failure (non-fatal).
 */
export async function runKrakenSegmentation(imagePath: string): Promise<LineSegment[] | null> {
  const venvPath = env.PYTHON_VENV_PATH;
  const pythonBin = path.join(venvPath, 'bin', 'python3');
  const scriptPath = path.resolve(__dirname, '../../python/kraken_segment.py');

  log.debug({ imagePath, pythonBin, scriptPath }, 'Running Kraken segmentation');

  try {
    const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, imagePath], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    if (stderr) {
      log.debug({ stderr: stderr.trim() }, 'Kraken stderr output');
    }

    const segments: LineSegment[] = JSON.parse(stdout);

    if (!Array.isArray(segments)) {
      log.warn('Kraken output is not an array');
      return null;
    }

    log.info({ imagePath, lineCount: segments.length }, 'Kraken segmentation completed');
    return segments;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.warn({ imagePath, err: message }, 'Kraken segmentation failed (non-fatal)');
    return null;
  }
}
