import { Helmet } from "react-helmet-async";

const SITE_NAME = "Letter Archive";
const DEFAULT_DESCRIPTION =
  "A digital archive preserving personal letters and historical correspondence.";
const BASE_URL = "https://letterarchive.org";

interface SEOProps {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogUrl?: string;
  ogType?: string;
  canonicalUrl?: string;
}

export default function SEO({
  title,
  description = DEFAULT_DESCRIPTION,
  ogTitle,
  ogDescription,
  ogImage,
  ogUrl,
  ogType = "website",
  canonicalUrl,
}: SEOProps) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const resolvedOgTitle = ogTitle || fullTitle;
  const resolvedOgDescription = ogDescription || description;
  const resolvedCanonical = canonicalUrl
    ? `${BASE_URL}${canonicalUrl}`
    : undefined;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />

      {/* Open Graph */}
      <meta property="og:title" content={resolvedOgTitle} />
      <meta property="og:description" content={resolvedOgDescription} />
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      {ogUrl && <meta property="og:url" content={ogUrl} />}
      {ogImage && <meta property="og:image" content={ogImage} />}

      {/* Twitter Card */}
      <meta name="twitter:card" content={ogImage ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={resolvedOgTitle} />
      <meta name="twitter:description" content={resolvedOgDescription} />
      {ogImage && <meta name="twitter:image" content={ogImage} />}

      {/* Canonical */}
      {resolvedCanonical && <link rel="canonical" href={resolvedCanonical} />}
    </Helmet>
  );
}
