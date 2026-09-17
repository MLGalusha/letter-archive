import { API_BASE_URL, getImageUrl } from '../api/client';

const WIDTHS = [480, 800, 1200, 1600];

/** Only our image endpoints understand rendition parameters; preserve external URLs. */
export function journalImageSources(source: string) {
  let url: URL;
  try { url = new URL(source, `${API_BASE_URL}/`); }
  catch { return { src: source, original: source, srcSet: undefined }; }
  const owned = url.origin === new URL(API_BASE_URL).origin
    && /^\/(blog-images|images)\/[^/]+$/.test(url.pathname);
  if (!owned) return { src: source, original: source, srcSet: undefined };
  url.searchParams.delete('w');
  url.searchParams.delete('rendition');
  const original = getImageUrl(url.toString());
  const rendition = (width: number) => {
    const result = new URL(getImageUrl(original, { width }));
    // Bump this when the journal encoding recipe changes: immutable browser URLs
    // must change too. Letter images retain their existing revalidation policy.
    if (result.pathname.startsWith('/blog-images/')) result.searchParams.set('rendition', '1');
    return result.toString();
  };
  return { original, src: rendition(800), srcSet: WIDTHS.map(width => `${rendition(width)} ${width}w`).join(', ') };
}

