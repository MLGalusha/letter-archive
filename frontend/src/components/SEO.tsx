import { useEffect } from "react";
import type { JsonLdObject } from "../utils/seo";

const SITE_NAME = "Voices That Remain";
const DEFAULT_DESCRIPTION =
  "A digital archive of personal letters and historical correspondence, preserved for future generations.";
const DEFAULT_BASE_URL = "https://voicesthatremain.com";

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

function setMeta(attr: string, key: string, content: string | undefined) {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function removeMeta(attr: string, key: string) {
  document.querySelector(`meta[${attr}="${key}"]`)?.remove();
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

  useEffect(() => {
    document.title = fullTitle;

    setMeta("name", "description", description);
    if (robots) setMeta("name", "robots", robots);
    else removeMeta("name", "robots");

    // Open Graph
    setMeta("property", "og:title", resolvedOgTitle);
    setMeta("property", "og:description", resolvedOgDescription);
    setMeta("property", "og:type", ogType);
    setMeta("property", "og:site_name", SITE_NAME);
    if (resolvedOgUrl) setMeta("property", "og:url", resolvedOgUrl);
    else removeMeta("property", "og:url");
    if (resolvedOgImage) setMeta("property", "og:image", resolvedOgImage);
    else removeMeta("property", "og:image");
    if (imageAlt) setMeta("property", "og:image:alt", imageAlt);
    else removeMeta("property", "og:image:alt");
    if (publishedTime) setMeta("property", "article:published_time", publishedTime);
    else removeMeta("property", "article:published_time");
    if (modifiedTime) setMeta("property", "article:modified_time", modifiedTime);
    else removeMeta("property", "article:modified_time");

    // Twitter Card
    setMeta("name", "twitter:card", resolvedOgImage ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", resolvedOgTitle);
    setMeta("name", "twitter:description", resolvedOgDescription);
    if (resolvedOgImage) setMeta("name", "twitter:image", resolvedOgImage);
    else removeMeta("name", "twitter:image");
    if (imageAlt) setMeta("name", "twitter:image:alt", imageAlt);
    else removeMeta("name", "twitter:image:alt");

    // Canonical
    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (resolvedCanonical) {
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.setAttribute("rel", "canonical");
        document.head.appendChild(canonical);
      }
      canonical.setAttribute("href", resolvedCanonical);
    } else {
      canonical?.remove();
    }

    // JSON-LD
    document.querySelectorAll('script[data-seo-jsonld]').forEach(el => el.remove());
    for (const entry of jsonLdEntries) {
      const script = document.createElement("script");
      script.setAttribute("type", "application/ld+json");
      script.setAttribute("data-seo-jsonld", "");
      script.textContent = JSON.stringify(entry);
      document.head.appendChild(script);
    }
  });

  return null;
}
