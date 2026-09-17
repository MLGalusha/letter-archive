export interface ImageDimensions { width: number; height: number }
export type JournalImageDimensions = Record<string, ImageDimensions>;
export function validImageDimensions(value: ImageDimensions | null | undefined): ImageDimensions | undefined {
  return value && Number.isInteger(value.width) && Number.isInteger(value.height)
    && value.width > 0 && value.height > 0 && value.width <= 100_000 && value.height <= 100_000 ? value : undefined;
}

export function dimensionsForPost(sources: string[], dimensions: JournalImageDimensions): JournalImageDimensions {
  return Object.fromEntries(sources.flatMap(source => {
    const value = Object.hasOwn(dimensions, source) && validImageDimensions(dimensions[source]);
    return value ? [[source, value]] : [];
  }));
}

/** Author-browser only; no server fetch and no public-reader metadata waterfall. */
export function readBrowserImageDimensions(source: string): Promise<ImageDimensions | undefined> {
  return new Promise(resolve => {
    const image = new Image();
    const finish = (value?: ImageDimensions) => { clearTimeout(timer); image.onload = null; image.onerror = null; image.removeAttribute('src'); resolve(value); };
    const timer = setTimeout(() => finish(), 8000);
    image.onload = () => finish(validImageDimensions({ width: image.naturalWidth, height: image.naturalHeight }));
    image.onerror = () => finish();
    image.src = source;
  });
}
