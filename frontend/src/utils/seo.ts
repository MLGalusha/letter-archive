import { API_BASE_URL, type BlogPost } from '../api/client';
import type { CollectionWithLetters } from '../api/collections';
import type { PublicPersonDetail, PublicPlaceDetail } from '../api/entities';
import type { PublicLetter } from '../types/Letter';

export interface JsonLdObject {
  [key: string]: unknown;
}

export interface SeoPayload {
  title: string;
  description: string;
  canonicalPath: string;
  ogType?: string;
  ogImage?: string;
  imageAlt?: string;
  publishedTime?: string;
  modifiedTime?: string;
  robots?: string;
  jsonLd?: JsonLdObject[];
}

export interface BreadcrumbItemInput {
  label: string;
  href?: string;
}

const DEFAULT_SITE_URL = 'https://voicesthatremain.com';
const SITE_NAME = 'Voices That Remain';
const DEFAULT_DESCRIPTION =
  'A digital archive of personal letters and historical correspondence, preserved for future generations.';

function getSiteUrl(): string {
  const candidate =
    import.meta.env.VITE_SITE_URL ||
    (typeof window !== 'undefined' ? window.location.origin : DEFAULT_SITE_URL);
  return candidate.replace(/\/+$/, '');
}

export function absoluteUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  return new URL(path, `${getSiteUrl()}/`).toString();
}

export function absoluteImageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return new URL(path, API_BASE_URL).toString();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function truncateText(value: string, maxLength = 160): string {
  const normalized = collapseWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const sliced = normalized.slice(0, Math.max(0, maxLength - 1));
  const boundary = sliced.lastIndexOf(' ');
  const shortened = boundary > Math.floor(maxLength * 0.6) ? sliced.slice(0, boundary) : sliced;
  return `${shortened.trim()}…`;
}

export function stripMarkdown(markdown: string): string {
  return collapseWhitespace(
    markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\|/g, ' ')
      .replace(/\*\*|__|\*|_/g, ' ')
  );
}

function getMeaningfulParagraphs(text: string): string[] {
  return text
    .replace(/---\s*Page\s+\d+\s*---/gi, '\n')
    .split(/\n{2,}/)
    .flatMap((chunk) => chunk.split('\n'))
    .map((chunk) => collapseWhitespace(chunk))
    .filter(Boolean);
}

function looksLikeGreeting(line: string): boolean {
  return /^(dear|dearest|my dear|hello|hi|greetings)\b/i.test(line);
}

export function getTranscriptExcerpt(text: string, maxLength = 160): string {
  const paragraphs = getMeaningfulParagraphs(text);
  const preferred =
    paragraphs.find((paragraph) => paragraph.length >= 48 && !looksLikeGreeting(paragraph)) ||
    paragraphs.find((paragraph) => paragraph.length >= 32) ||
    paragraphs[0];

  return preferred ? truncateText(preferred, maxLength) : '';
}

function isoDateFromRaw(dateRaw?: string): string | undefined {
  if (!dateRaw) return undefined;
  if (/^\d{8}$/.test(dateRaw)) {
    return `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
  }
  if (/^\d{4}X{4}$/.test(dateRaw)) {
    return dateRaw.slice(0, 4);
  }
  return undefined;
}

function formatTopicLabel(topic: string): string {
  return topic
    .split('/')
    .map((part) => part.replace(/-/g, ' '))
    .join(' - ');
}

function buildKeywords(values: Array<string | null | undefined>): string[] | undefined {
  const unique = Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  return unique.length > 0 ? unique : undefined;
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItemInput[]): JsonLdObject | undefined {
  const list = items.filter((item) => item.href);
  if (list.length === 0) return undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: item.href ? absoluteUrl(item.href) : undefined,
    })),
  };
}

export function buildHomeSeo(): SeoPayload {
  const websiteUrl = absoluteUrl('/');
  return {
    title: 'A Letter Archive',
    description:
      'A digital archive of personal letters and historical correspondence, preserved for future generations. Browse, search, and explore letters from across the decades.',
    canonicalPath: '/',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: websiteUrl,
        description: DEFAULT_DESCRIPTION,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: websiteUrl,
      },
    ],
  };
}

export function buildBlogIndexSeo(page: number): SeoPayload {
  const title = page > 1 ? `Journal - Page ${page}` : 'Journal';
  const description =
    'Read field notes, collection highlights, and essays from Voices That Remain as the project grows.';
  const canonicalPath = page > 1 ? `/blog?page=${page}` : '/blog';
  const breadcrumb = buildBreadcrumbJsonLd([
    { label: 'Home', href: '/' },
    { label: 'Journal', href: '/blog' },
    ...(page > 1 ? [{ label: `Page ${page}`, href: canonicalPath }] : []),
  ]);

  return {
    title,
    description,
    canonicalPath,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${SITE_NAME} Journal`,
        url: absoluteUrl(canonicalPath),
        description,
      },
      ...(breadcrumb ? [breadcrumb] : []),
    ],
  };
}

export function buildBlogPostSeo(post: BlogPost): SeoPayload {
  const title = post.seoTitle || post.title;
  const description =
    post.seoDescription ||
    post.excerpt ||
    truncateText(stripMarkdown(post.bodyMarkdown), 160) ||
    `Read "${post.title}" on ${SITE_NAME}.`;
  const canonicalPath = `/blog/${post.slug}`;
  const breadcrumb = buildBreadcrumbJsonLd([
    { label: 'Home', href: '/' },
    { label: 'Journal', href: '/blog' },
    { label: post.title, href: canonicalPath },
  ]);

  return {
    title,
    description,
    canonicalPath,
    ogType: 'article',
    ogImage: absoluteImageUrl(post.heroImageUrl) || undefined,
    imageAlt: post.heroImageAlt || post.title,
    publishedTime: post.publishedAt || post.createdAt,
    modifiedTime: post.updatedAt || post.publishedAt || post.createdAt,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: title,
        description,
        url: absoluteUrl(canonicalPath),
        mainEntityOfPage: absoluteUrl(canonicalPath),
        datePublished: post.publishedAt || post.createdAt,
        dateModified: post.updatedAt || post.publishedAt || post.createdAt,
        image: absoluteImageUrl(post.heroImageUrl),
        articleSection: post.category || undefined,
        author: post.authorDisplayName
          ? {
              '@type': 'Person',
              name: post.authorDisplayName,
            }
          : {
              '@type': 'Organization',
              name: SITE_NAME,
            },
        publisher: {
          '@type': 'Organization',
          name: SITE_NAME,
          url: absoluteUrl('/'),
        },
      },
      ...(breadcrumb ? [breadcrumb] : []),
    ],
  };
}

export function buildLetterTitle(letter: PublicLetter): string {
  const people = [letter.metadata.sender, letter.metadata.recipient].filter(Boolean);
  const direction =
    people.length === 2
      ? `Letter from ${letter.metadata.sender} to ${letter.metadata.recipient}`
      : people.length === 1
        ? `Letter ${letter.metadata.sender ? `from ${letter.metadata.sender}` : `to ${letter.metadata.recipient}`}`
        : letter.title;

  return letter.metadata.date ? `${direction}, ${letter.metadata.date}` : direction;
}

export function buildLetterDescription(letter: PublicLetter): string {
  const summary = collapseWhitespace(letter.metadata.description || '');
  if (summary) {
    return truncateText(summary, 160);
  }

  const hook = collapseWhitespace(letter.metadata.hook || '');
  if (hook) {
    return truncateText(hook, 160);
  }

  const transcriptExcerpt = getTranscriptExcerpt(letter.transcript.fullText, 160);
  if (transcriptExcerpt) {
    return transcriptExcerpt;
  }

  return 'Read this historical letter on Voices That Remain.';
}

export function buildLetterSeo(letter: PublicLetter): SeoPayload {
  const title = buildLetterTitle(letter);
  const description = buildLetterDescription(letter);
  const canonicalPath = `/letter/${letter.id}`;
  const dateCreated = isoDateFromRaw(letter.metadata.dateRaw);
  const keywords = buildKeywords([
    ...(letter.metadata.primaryTopics || []).map(formatTopicLabel),
    ...(letter.metadata.tags || []),
    letter.metadata.location,
  ]);
  const mentions = [
    ...(letter.linkedPersons || []).map((person) => ({
      '@type': 'Person',
      name: person.canonicalName,
    })),
    ...(letter.linkedPlaces || []).map((place) => ({
      '@type': 'Place',
      name: place.canonicalName,
    })),
  ];
  const breadcrumb = buildBreadcrumbJsonLd([
    { label: 'Home', href: '/' },
    { label: 'Collections', href: '/collections' },
    ...(letter.collectionCode
      ? [{ label: `Collection ${letter.collectionCode}`, href: `/collections/${letter.collectionCode}` }]
      : []),
    { label: title, href: canonicalPath },
  ]);

  return {
    title,
    description,
    canonicalPath,
    ogType: 'article',
    ogImage: absoluteImageUrl(letter.images[0]?.imageUrl),
    imageAlt: title,
    modifiedTime: letter.updatedAt || letter.createdAt,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: title,
        description,
        url: absoluteUrl(canonicalPath),
        image: absoluteImageUrl(letter.images[0]?.imageUrl),
        creator: letter.metadata.sender
          ? {
              '@type': 'Person',
              name: letter.metadata.sender,
            }
          : undefined,
        dateCreated,
        isPartOf: letter.collectionCode
          ? {
              '@type': 'Collection',
              name: `Collection ${letter.collectionCode}`,
              url: absoluteUrl(`/collections/${letter.collectionCode}`),
            }
          : undefined,
        keywords,
        mentions: mentions.length > 0 ? mentions : undefined,
      },
      ...(breadcrumb ? [breadcrumb] : []),
    ],
  };
}

export function buildCollectionSeo(
  collection: CollectionWithLetters,
  dateRange: { start: string; end: string } | null,
  topCorrespondents: Array<{ name: string; count: number }>
): SeoPayload {
  const title = collection.title || `Collection ${collection.collectionCode}`;
  const autoDescriptionParts = [
    `Browse ${collection.letterCount ?? collection.letters.length} historical letter${(collection.letterCount ?? collection.letters.length) === 1 ? '' : 's'} in ${title}.`,
    dateRange ? `Date span: ${dateRange.start} to ${dateRange.end}.` : '',
    topCorrespondents.length > 0
      ? `Key correspondents include ${topCorrespondents.map((person) => person.name).join(', ')}.`
      : '',
  ];
  const description = truncateText(
    collection.description || autoDescriptionParts.filter(Boolean).join(' '),
    160
  );
  const canonicalPath = `/collections/${collection.collectionCode}`;
  const breadcrumb = buildBreadcrumbJsonLd([
    { label: 'Home', href: '/' },
    { label: 'Collections', href: '/collections' },
    { label: title, href: canonicalPath },
  ]);

  return {
    title,
    description,
    canonicalPath,
    ogType: 'article',
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Collection',
        name: title,
        description,
        url: absoluteUrl(canonicalPath),
      },
      ...(breadcrumb ? [breadcrumb] : []),
    ],
  };
}

export function buildPersonSeo(data: PublicPersonDetail): SeoPayload {
  const title = data.person.canonicalName;
  const description = truncateText(
    data.person.biography ||
      `${title} appears in ${data.stats.total} published letter${data.stats.total === 1 ? '' : 's'} in the ${SITE_NAME}.`,
    160
  );
  const canonicalPath = `/people/${data.person.id}`;
  const breadcrumb = buildBreadcrumbJsonLd([
    { label: 'Home', href: '/' },
    { label: title, href: canonicalPath },
  ]);

  return {
    title,
    description,
    canonicalPath,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: title,
        alternateName: data.person.aliases.length > 0 ? data.person.aliases : undefined,
        description,
        url: absoluteUrl(canonicalPath),
      },
      ...(breadcrumb ? [breadcrumb] : []),
    ],
  };
}

export function buildPlaceSeo(data: PublicPlaceDetail): SeoPayload {
  const title = data.place.canonicalName;
  const description = truncateText(
    data.place.notes ||
      `${title} appears in ${data.stats.total} published letter${data.stats.total === 1 ? '' : 's'} in the ${SITE_NAME}.`,
    160
  );
  const canonicalPath = `/places/${data.place.id}`;
  const breadcrumb = buildBreadcrumbJsonLd([
    { label: 'Home', href: '/' },
    { label: title, href: canonicalPath },
  ]);

  return {
    title,
    description,
    canonicalPath,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'Place',
        name: title,
        alternateName: data.place.aliases.length > 0 ? data.place.aliases : undefined,
        description,
        url: absoluteUrl(canonicalPath),
      },
      ...(breadcrumb ? [breadcrumb] : []),
    ],
  };
}

export function buildNotFoundSeo(): SeoPayload {
  return {
    title: 'Page Not Found',
    description: DEFAULT_DESCRIPTION,
    canonicalPath: '/404',
    robots: 'noindex,nofollow',
  };
}
