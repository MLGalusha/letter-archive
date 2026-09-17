import { createHash } from 'node:crypto';
import sharp from 'sharp';

export type ImageVariantFormat = 'avif' | 'webp' | 'jpeg';

// Bump when rotate/resize options, quality, effort or other output semantics change.
const IMAGE_RECIPE_VERSION = 1;

/** Identity comes from the checked source, never the caller's URL version hint. */
export function imageVariantIdentity(source: {
  pageId: string;
  checksumSha256?: string | null;
  storagePath: string;
  mtimeMs: number;
  size: number;
}, width: number, format: ImageVariantFormat): string {
  return createHash('sha256').update(JSON.stringify([
    IMAGE_RECIPE_VERSION,
    source.pageId, source.checksumSha256 ?? null, source.storagePath,
    source.mtimeMs, source.size, width, format,
    // Library upgrades can change encoded bytes even with the same recipe.
    Object.entries(sharp.versions ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ])).digest('hex');
}
