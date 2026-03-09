import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db, letterPages } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger({ module: 'vision-ocr' });

export interface BoxPixelStats {
  inkDensity: number;    // fraction of pixels darker than adaptive threshold (0-1)
  variance: number;      // pixel intensity variance (higher = more contrast)
  minValue: number;      // darkest pixel (0=black, 255=white)
  meanValue: number;     // average pixel brightness
}

export interface OcrWordBox {
  text: string;
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  confidence: number;
  pixelStats?: BoxPixelStats;
  hasContent?: boolean;  // determined by pixel analysis
}

/**
 * Runs Google Vision documentTextDetection on an image and extracts
 * word-level bounding boxes. Returns null if Vision is not configured
 * or on any error (non-fatal).
 */
export async function runVisionWordDetection(imagePath: string): Promise<OcrWordBox[] | null> {
  try {
    // Apply EXIF orientation so Vision sees the image as displayed
    const correctedBuffer = await sharp(imagePath).rotate().toBuffer();

    const { ImageAnnotatorClient } = await import('@google-cloud/vision');
    const client = new ImageAnnotatorClient();

    const [result] = await client.documentTextDetection({ image: { content: correctedBuffer } });
    const annotation = result.fullTextAnnotation;

    if (!annotation?.pages?.length) {
      log.warn({ imagePath }, 'Vision returned no text annotation');
      return null;
    }

    const wordBoxes: OcrWordBox[] = [];

    for (const page of annotation.pages) {
      for (const block of page.blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const word of paragraph.words ?? []) {
            const text = word.symbols?.map(s => s.text).join('') ?? '';
            if (!text) continue;

            const vertices = word.boundingBox?.vertices;
            if (!vertices || vertices.length < 4) continue;

            const xs = vertices.map(v => v.x ?? 0);
            const ys = vertices.map(v => v.y ?? 0);

            wordBoxes.push({
              text,
              bbox: [
                Math.min(...xs),
                Math.min(...ys),
                Math.max(...xs),
                Math.max(...ys),
              ],
              confidence: word.confidence ?? 0,
            });
          }
        }
      }
    }

    log.info({ imagePath, wordCount: wordBoxes.length }, 'Vision word detection completed');

    // Analyze pixels inside each box to classify content vs empty/bleed
    await analyzeBoxPixels(correctedBuffer, wordBoxes);

    return wordBoxes;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.warn({ imagePath, err: message }, 'Vision word detection failed (non-fatal)');
    return null;
  }
}

/**
 * Analyzes the pixels inside each OCR word box to compute ink density,
 * variance, and darkness metrics. Then compares each box against the
 * page-wide distribution to classify as hasContent or not.
 *
 * Three-tier detection:
 * 1. Fixed floor: boxes with extremely low variance are definitely empty
 * 2. Relative comparison: boxes well below the page median are likely
 *    page bleed or noise (lighter than real ink)
 * 3. Real writing: boxes near or above the page median
 */
async function analyzeBoxPixels(
  correctedBuffer: Buffer,
  wordBoxes: OcrWordBox[],
): Promise<void> {
  if (wordBoxes.length === 0) return;

  const imgMeta = await sharp(correctedBuffer).metadata();
  const imgWidth = imgMeta.width ?? 0;
  const imgHeight = imgMeta.height ?? 0;
  if (imgWidth === 0 || imgHeight === 0) return;

  // Convert to single-channel grayscale for pixel analysis
  const grayBuffer = await sharp(correctedBuffer)
    .grayscale()
    .raw()
    .toBuffer();

  // Compute stats for each box
  for (const box of wordBoxes) {
    const [x1, y1, x2, y2] = box.bbox;

    // Clamp to image bounds
    const left = Math.max(0, Math.min(x1, imgWidth - 1));
    const top = Math.max(0, Math.min(y1, imgHeight - 1));
    const right = Math.max(left + 1, Math.min(x2, imgWidth));
    const bottom = Math.max(top + 1, Math.min(y2, imgHeight));
    const boxW = right - left;
    const boxH = bottom - top;
    const pixelCount = boxW * boxH;

    if (pixelCount === 0) {
      box.pixelStats = { inkDensity: 0, variance: 0, minValue: 255, meanValue: 255 };
      continue;
    }

    // Extract pixel values from the grayscale buffer
    let sum = 0;
    let sumSq = 0;
    let minVal = 255;

    for (let row = top; row < bottom; row++) {
      const rowOffset = row * imgWidth;
      for (let col = left; col < right; col++) {
        const val = grayBuffer[rowOffset + col];
        sum += val;
        sumSq += val * val;
        if (val < minVal) minVal = val;
      }
    }

    const mean = sum / pixelCount;
    const variance = (sumSq / pixelCount) - (mean * mean);

    // Ink density: fraction of pixels darker than (mean - 1 stddev)
    // This adapts to the paper color within each box
    const threshold = mean - Math.sqrt(variance);
    let darkCount = 0;
    for (let row = top; row < bottom; row++) {
      const rowOffset = row * imgWidth;
      for (let col = left; col < right; col++) {
        if (grayBuffer[rowOffset + col] < threshold) darkCount++;
      }
    }

    box.pixelStats = {
      inkDensity: darkCount / pixelCount,
      variance,
      minValue: minVal,
      meanValue: mean,
    };
  }

  // --- Classification: compare each box against page-wide distribution ---

  const allVariances = wordBoxes.map(b => b.pixelStats!.variance);
  const allDensities = wordBoxes.map(b => b.pixelStats!.inkDensity);
  const allMinValues = wordBoxes.map(b => b.pixelStats!.minValue);

  // Sort to get medians
  const sortedVar = [...allVariances].sort((a, b) => a - b);
  const sortedDensity = [...allDensities].sort((a, b) => a - b);
  const sortedMin = [...allMinValues].sort((a, b) => a - b);

  const medianVariance = sortedVar[Math.floor(sortedVar.length / 2)];
  const medianDensity = sortedDensity[Math.floor(sortedDensity.length / 2)];
  const medianMinValue = sortedMin[Math.floor(sortedMin.length / 2)];

  // Fixed floor thresholds — below these, definitely empty
  const VARIANCE_FLOOR = 50;       // nearly uniform pixel region
  const DENSITY_FLOOR = 0.02;      // less than 2% dark pixels

  // Relative thresholds — compared against page median
  const VARIANCE_RATIO = 0.25;     // below 25% of median variance → likely empty/bleed
  const DENSITY_RATIO = 0.25;      // below 25% of median density → likely empty/bleed
  const MIN_VALUE_PENALTY = 60;    // if darkest pixel is 60+ lighter than median darkest → bleed

  for (const box of wordBoxes) {
    const stats = box.pixelStats!;

    // Fixed floor: definitely empty
    if (stats.variance < VARIANCE_FLOOR && stats.inkDensity < DENSITY_FLOOR) {
      box.hasContent = false;
      continue;
    }

    // Relative comparison: count how many signals say "not real content"
    let weakSignals = 0;

    if (medianVariance > 0 && stats.variance < medianVariance * VARIANCE_RATIO) {
      weakSignals++;
    }
    if (medianDensity > 0 && stats.inkDensity < medianDensity * DENSITY_RATIO) {
      weakSignals++;
    }
    if (stats.minValue > medianMinValue + MIN_VALUE_PENALTY) {
      weakSignals++; // darkest pixel much lighter than typical → page bleed
    }

    // Need at least 2 weak signals to classify as no content
    box.hasContent = weakSignals < 2;
  }

  const contentCount = wordBoxes.filter(b => b.hasContent).length;
  log.info({
    totalBoxes: wordBoxes.length,
    contentBoxes: contentCount,
    emptyBoxes: wordBoxes.length - contentCount,
    medianVariance: Math.round(medianVariance),
    medianDensity: Math.round(medianDensity * 1000) / 1000,
    medianMinValue: Math.round(medianMinValue),
  }, 'Box pixel analysis complete');
}

/**
 * Detects word-level bounding boxes via Google Vision and stores them
 * in the letter_pages.ocr_word_boxes column. Returns the boxes or null.
 */
export async function detectAndStorePageOcrWords(
  pageId: string,
  imagePath: string,
): Promise<OcrWordBox[] | null> {
  const wordBoxes = await runVisionWordDetection(imagePath);
  if (wordBoxes) {
    await db.update(letterPages).set({
      ocrWordBoxes: wordBoxes,
      updatedAt: new Date(),
    }).where(eq(letterPages.id, pageId));
  }
  return wordBoxes;
}
