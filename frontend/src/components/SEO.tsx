import { Helmet } from "react-helmet-async";
import type { JsonLdObject } from "../utils/seo";

const SITE_NAME = "Letter Archive";
const DEFAULT_DESCRIPTION =
  "A digital archive preserving personal letters and historical correspondence.";
const DEFAULT_BASE_URL = "https://letterarchive.org";

interface SEOProps {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  imageAlt?: string;
  ogUrl?: string;
  ogType?: string;
  canonicalUrl?: string;
  robots?: string;
  publishedTime?: string;
  modifiedTime?: string;
  jsonLd?: JsonLdObject | JsonLdObject[];
}

export default function SEO({
  title,
  description = DEFAULT_DESCRIPTION,
  ogTitle,
  ogDescription,
  ogImage,
  imageAlt,
  ogUrl,
  ogType = "website",
  canonicalUrl,
  robots,
  publishedTime,
  modifiedTime,
  jsonLd,
}: SEOProps) {
  const baseUrl = (
    import.meta.env.VITE_SITE_URL ||
    (typeof window !== "undefined" ? window.location.origin : DEFAULT_BASE_URL)
  ).replace(/\/+$/, "");
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const resolvedOgTitle = ogTitle || fullTitle;
  const resolvedOgDescription = ogDescription || description;
  const resolvedCanonical = canonicalUrl
    ? new URL(canonicalUrl, `${baseUrl}/`).toString()
    : undefined;
  const resolvedOgUrl = ogUrl
    ? new URL(ogUrl, `${baseUrl}/`).toString()
    : resolvedCanonical;
  const resolvedOgImage = ogImage ? new URL(ogImage, `${baseUrl}/`).toString() : undefined;
  const jsonLdEntries = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {robots && <meta name="robots" content={robots} />}

      {/* Open Graph */}
      <meta property="og:title" content={resolvedOgTitle} />
      <meta property="og:description" content={resolvedOgDescription} />
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      {resolvedOgUrl && <meta property="og:url" content={resolvedOgUrl} />}
      {resolvedOgImage && <meta property="og:image" content={resolvedOgImage} />}
      {imageAlt && <meta property="og:image:alt" content={imageAlt} />}
      {publishedTime && <meta property="article:published_time" content={publishedTime} />}
      {modifiedTime && <meta property="article:modified_time" content={modifiedTime} />}

      {/* Twitter Card */}
      <meta name="twitter:card" content={resolvedOgImage ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={resolvedOgTitle} />
      <meta name="twitter:description" content={resolvedOgDescription} />
      {resolvedOgImage && <meta name="twitter:image" content={resolvedOgImage} />}
      {imageAlt && <meta name="twitter:image:alt" content={imageAlt} />}

      {/* Canonical */}
      {resolvedCanonical && <link rel="canonical" href={resolvedCanonical} />}

      {jsonLdEntries.map((entry, index) => (
        <script key={`json-ld-${index}`} type="application/ld+json">
          {JSON.stringify(entry)}
        </script>
      ))}
    </Helmet>
  );
}
