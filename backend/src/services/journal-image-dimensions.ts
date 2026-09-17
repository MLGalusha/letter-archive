import sharp from 'sharp';
import { resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { z } from 'zod';

export const imageDimensionsSchema = z.object({
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
}).strict();
export type ImageDimensions = z.infer<typeof imageDimensionsSchema>;
export const journalDimensionsSchema = z.record(z.string().min(1).max(2048), imageDimensionsSchema)
  .refine(map => Object.keys(map).length <= 64, 'At most 64 image dimensions per post');

/** EXIF rotation affects displayed axes; animated metadata height may be a strip. */
export async function readImageDimensions(path: string): Promise<ImageDimensions | undefined> {
  try {
    const meta = await sharp(path, { limitInputPixels: 40_000_000 }).metadata();
    const width = meta.width;
    const height = meta.pageHeight || meta.height;
    const rotated = (meta.orientation ?? 1) >= 5;
    const parsed = imageDimensionsSchema.safeParse(rotated ? { width: height, height: width } : { width, height });
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

/** Explicit admin saves only. Never fetch a URL or probe files on public reads. */
export async function resolveJournalImageDimensions(
  sources: string[],
  dimensions: Record<string, ImageDimensions>,
  options: { storageDir: string; apiOrigin: string; findLetterPath: (id: string) => Promise<string | undefined> },
) {
  const result = sources.length ? Object.fromEntries(Object.entries(dimensions).filter(([source]) => sources.includes(source))) : { ...dimensions };
  const unresolved: string[] = [];
  if (!sources.length) return { dimensions: result, unresolved };
  const root = await realpath(resolve(options.storageDir)).catch(() => undefined);
  for (const source of [...new Set(sources)].slice(0, 64)) {
    let url: URL;
    try { url = new URL(source, options.apiOrigin); } catch { continue; }
    if (url.origin !== options.apiOrigin) continue;
    const blog = url.pathname.match(/^\/blog-images\/([\w-]+\.[\w]+)$/);
    const letter = url.pathname.match(/^\/images\/([\da-f-]{36})$/i);
    if (!blog && !letter) continue;
    const path = blog ? resolve(options.storageDir, 'blog', blog[1]) : await options.findLetterPath(letter![1]);
    const real = path && await realpath(path).catch(() => undefined);
    const value = real && root && real.startsWith(root + sep) ? await readImageDimensions(real) : undefined;
    if (value) result[source] = value;
    else { delete result[source]; unresolved.push(source); }
  }
  return { dimensions: result, unresolved };
}
