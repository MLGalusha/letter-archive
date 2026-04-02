import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  absoluteImageUrl,
  truncateText,
  stripMarkdown,
  buildHomeSeo,
  buildCollectionSeo,
  buildLetterSeo,
  buildBlogPostSeo,
  buildBlogIndexSeo,
  buildNotFoundSeo,
  buildBreadcrumbJsonLd,
  buildLetterTitle,
  getTranscriptExcerpt,
} from '../seo';
import type { BlogPost } from '../../api/client';
import type { CollectionWithLetters } from '../../api/collections';
import type { Letter } from '../../types/Letter';

// ── absoluteUrl ──────────────────────────────────────────────────────────────

describe('absoluteUrl', () => {
  it('returns a full URL for a relative path', () => {
    const result = absoluteUrl('/blog');
    expect(result).toMatch(/\/blog$/);
    expect(result).toMatch(/^https?:\/\//);
  });

  it('returns undefined for null', () => {
    expect(absoluteUrl(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(absoluteUrl(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(absoluteUrl('')).toBeUndefined();
  });

  it('handles paths without leading slash', () => {
    const result = absoluteUrl('about');
    expect(result).toBeDefined();
    expect(result).toContain('about');
  });
});

// ── absoluteImageUrl ─────────────────────────────────────────────────────────

describe('absoluteImageUrl', () => {
  it('returns undefined for null', () => {
    expect(absoluteImageUrl(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(absoluteImageUrl(undefined)).toBeUndefined();
  });

  it('returns the same URL for absolute https URLs', () => {
    const url = 'https://cdn.example.com/image.jpg';
    expect(absoluteImageUrl(url)).toBe(url);
  });

  it('returns the same URL for absolute http URLs', () => {
    const url = 'http://cdn.example.com/image.jpg';
    expect(absoluteImageUrl(url)).toBe(url);
  });

  it('prepends API base for relative paths', () => {
    const result = absoluteImageUrl('/uploads/photo.png');
    expect(result).toBeDefined();
    expect(result).toContain('/uploads/photo.png');
    expect(result).toMatch(/^https?:\/\//);
  });
});

// ── truncateText ─────────────────────────────────────────────────────────────

describe('truncateText', () => {
  it('returns short text unchanged', () => {
    expect(truncateText('Hello world')).toBe('Hello world');
  });

  it('collapses whitespace in short text', () => {
    expect(truncateText('Hello   world\n  foo')).toBe('Hello world foo');
  });

  it('truncates long text with ellipsis', () => {
    const long = 'word '.repeat(100);
    const result = truncateText(long, 50);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toMatch(/…$/);
  });

  it('breaks at word boundary when possible', () => {
    // Build text that is just over the limit
    const text = 'The quick brown fox jumps over the lazy dog near the riverbank';
    const result = truncateText(text, 30);
    expect(result).toMatch(/…$/);
    // The text before the ellipsis should end at a word boundary,
    // meaning the last char before the ellipsis is a letter (not a space-then-partial-word)
    const withoutEllipsis = result.slice(0, -1).trim();
    // Should be a substring of the original that ends on a complete word
    expect(text).toContain(withoutEllipsis);
    // Should not contain a partial word (no truncation mid-word)
    const lastWord = withoutEllipsis.split(' ').pop()!;
    expect(text.split(' ')).toContain(lastWord);
  });

  it('respects custom maxLength', () => {
    const text = 'a '.repeat(200);
    const result = truncateText(text, 80);
    expect(result.length).toBeLessThanOrEqual(80);
  });
});

// ── stripMarkdown ────────────────────────────────────────────────────────────

describe('stripMarkdown', () => {
  it('strips headers', () => {
    expect(stripMarkdown('## Hello World')).toBe('Hello World');
  });

  it('strips bold markers', () => {
    expect(stripMarkdown('This is **bold** text')).toBe('This is bold text');
  });

  it('strips italic markers', () => {
    expect(stripMarkdown('This is *italic* text')).toBe('This is italic text');
  });

  it('extracts link text', () => {
    expect(stripMarkdown('[click here](https://example.com)')).toBe('click here');
  });

  it('extracts image alt text', () => {
    expect(stripMarkdown('![alt text](https://example.com/img.png)')).toBe('alt text');
  });

  it('strips code blocks', () => {
    const md = 'before\n```\ncode\n```\nafter';
    expect(stripMarkdown(md)).toBe('before after');
  });

  it('strips inline code', () => {
    expect(stripMarkdown('use `npm install` here')).toBe('use npm install here');
  });

  it('strips blockquotes', () => {
    expect(stripMarkdown('> quoted text')).toBe('quoted text');
  });

  it('strips list markers', () => {
    expect(stripMarkdown('- item one\n- item two')).toBe('item one item two');
  });

  it('strips pipe characters', () => {
    expect(stripMarkdown('col1 | col2')).toBe('col1 col2');
  });

  it('handles combined markdown', () => {
    const md = '## Title\n\n**Bold** and [link](url)\n\n- list item';
    const result = stripMarkdown(md);
    expect(result).toBe('Title Bold and link list item');
  });
});

// ── getTranscriptExcerpt ─────────────────────────────────────────────────────

describe('getTranscriptExcerpt', () => {
  it('picks a paragraph with sufficient length over a greeting', () => {
    const text = 'Dear Martha,\n\nI hope this letter finds you well. The weather has been particularly warm this season and the garden is thriving beautifully.';
    const result = getTranscriptExcerpt(text);
    expect(result).not.toMatch(/^Dear/);
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back to first paragraph when nothing else qualifies', () => {
    const text = 'Short.';
    const result = getTranscriptExcerpt(text);
    expect(result).toBe('Short.');
  });

  it('returns empty string for empty text', () => {
    expect(getTranscriptExcerpt('')).toBe('');
  });
});

// ── buildHomeSeo ─────────────────────────────────────────────────────────────

describe('buildHomeSeo', () => {
  it('returns the correct title', () => {
    const seo = buildHomeSeo();
    expect(seo.title).toBe('A Letter Archive');
  });

  it('returns a description mentioning archive', () => {
    const seo = buildHomeSeo();
    expect(seo.description).toContain('archive');
  });

  it('sets canonicalPath to /', () => {
    const seo = buildHomeSeo();
    expect(seo.canonicalPath).toBe('/');
  });

  it('includes WebSite and Organization JSON-LD', () => {
    const seo = buildHomeSeo();
    expect(seo.jsonLd).toBeDefined();
    const types = seo.jsonLd!.map((item) => item['@type']);
    expect(types).toContain('WebSite');
    expect(types).toContain('Organization');
  });
});

// ── buildCollectionSeo ───────────────────────────────────────────────────────

describe('buildCollectionSeo', () => {
  const baseCollection: CollectionWithLetters = {
    id: 'col-1',
    collectionCode: 'ABC',
    title: 'Family Letters',
    description: null,
    createdAt: '2024-01-01',
    letters: [],
    letterCount: 12,
  };

  it('uses collection title in SEO title', () => {
    const seo = buildCollectionSeo(baseCollection, null, []);
    expect(seo.title).toBe('Family Letters');
  });

  it('falls back to collection code when title is null', () => {
    const seo = buildCollectionSeo(
      { ...baseCollection, title: null },
      null,
      [],
    );
    expect(seo.title).toBe('Collection ABC');
  });

  it('builds auto-description with letter count', () => {
    const seo = buildCollectionSeo(baseCollection, null, []);
    expect(seo.description).toContain('12');
  });

  it('includes date range in description when provided', () => {
    const seo = buildCollectionSeo(
      baseCollection,
      { start: '1942', end: '1945' },
      [],
    );
    expect(seo.description).toContain('1942');
    expect(seo.description).toContain('1945');
  });

  it('includes top correspondents in description', () => {
    const seo = buildCollectionSeo(baseCollection, null, [
      { name: 'Alice', count: 5 },
      { name: 'Bob', count: 3 },
    ]);
    expect(seo.description).toContain('Alice');
    expect(seo.description).toContain('Bob');
  });

  it('prefers collection.description over auto-generated', () => {
    const seo = buildCollectionSeo(
      { ...baseCollection, description: 'Custom description here.' },
      { start: '1942', end: '1945' },
      [{ name: 'Alice', count: 5 }],
    );
    expect(seo.description).toBe('Custom description here.');
  });

  it('sets canonicalPath based on collection code', () => {
    const seo = buildCollectionSeo(baseCollection, null, []);
    expect(seo.canonicalPath).toBe('/collections/ABC');
  });

  it('sets ogType to article', () => {
    const seo = buildCollectionSeo(baseCollection, null, []);
    expect(seo.ogType).toBe('article');
  });

  it('includes Collection JSON-LD', () => {
    const seo = buildCollectionSeo(baseCollection, null, []);
    const types = seo.jsonLd!.map((item) => item['@type']);
    expect(types).toContain('Collection');
  });

  it('includes breadcrumb JSON-LD', () => {
    const seo = buildCollectionSeo(baseCollection, null, []);
    const types = seo.jsonLd!.map((item) => item['@type']);
    expect(types).toContain('BreadcrumbList');
  });
});

// ── buildLetterSeo ───────────────────────────────────────────────────────────

describe('buildLetterSeo', () => {
  const baseLetter: Letter = {
    id: 'letter-1',
    title: 'Untitled Letter',
    collectionCode: 'ABC',
    images: [{ id: 'img-1', type: 'letter', imageUrl: '/uploads/img1.jpg' }],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Hello there' }],
      fullText: 'Hello there',
      verified: true,
    },
    metadata: {
      sender: 'Alice',
      recipient: 'Bob',
      date: 'March 15, 1943',
      dateRaw: '19430315',
      location: 'New York',
      verified: true,
      description: 'A letter about spring.',
      primaryTopics: ['family/daily-life'],
      tags: ['spring', 'weather'],
    },
    status: 'published',
    workflowState: 'REVIEWED',
    visibility: 'PUBLISHED',
    transcriptPublished: true,
    metadataPublished: true,
    transcriptStatus: 'VERIFIED',
    metadataContentStatus: 'VERIFIED',
    extraContentStatus: 'EMPTY',
    createdAt: '2024-01-01',
    updatedAt: '2024-06-15',
    flagged: false,
    linkedPersons: [
      { id: 'lp-1', personId: 'p-1', canonicalName: 'Charlie', role: 'mentioned', confidence: 1 },
    ],
    linkedPlaces: [
      { id: 'lpl-1', placeId: 'pl-1', canonicalName: 'Paris', role: 'mentioned', confidence: 1 },
    ],
  };

  it('builds title with sender, recipient, and date', () => {
    const seo = buildLetterSeo(baseLetter);
    expect(seo.title).toContain('Alice');
    expect(seo.title).toContain('Bob');
    expect(seo.title).toContain('March 15, 1943');
  });

  it('uses metadata.description for SEO description', () => {
    const seo = buildLetterSeo(baseLetter);
    expect(seo.description).toBe('A letter about spring.');
  });

  it('falls back to transcript excerpt when no description', () => {
    const letter: Letter = {
      ...baseLetter,
      metadata: { ...baseLetter.metadata, description: undefined, hook: undefined },
      transcript: {
        pages: [{ pageNumber: 1, text: 'The weather has been rather fine lately and I have been thinking of you often.' }],
        fullText: 'The weather has been rather fine lately and I have been thinking of you often.',
        verified: true,
      },
    };
    const seo = buildLetterSeo(letter);
    expect(seo.description).toContain('weather');
  });

  it('sets ogImage from first image', () => {
    const seo = buildLetterSeo(baseLetter);
    expect(seo.ogImage).toBeDefined();
    expect(seo.ogImage).toContain('img1.jpg');
  });

  it('handles letter with no images', () => {
    const letter: Letter = { ...baseLetter, images: [] };
    const seo = buildLetterSeo(letter);
    expect(seo.ogImage).toBeUndefined();
  });

  it('includes CreativeWork JSON-LD with mentions', () => {
    const seo = buildLetterSeo(baseLetter);
    const creative = seo.jsonLd!.find((item) => item['@type'] === 'CreativeWork');
    expect(creative).toBeDefined();
    expect(creative!.mentions).toBeDefined();
    const mentions = creative!.mentions as Array<{ '@type': string; name: string }>;
    const names = mentions.map((m) => m.name);
    expect(names).toContain('Charlie');
    expect(names).toContain('Paris');
  });

  it('sets canonicalPath correctly', () => {
    const seo = buildLetterSeo(baseLetter);
    expect(seo.canonicalPath).toBe('/letter/letter-1');
  });

  it('includes breadcrumb with collection', () => {
    const seo = buildLetterSeo(baseLetter);
    const breadcrumb = seo.jsonLd!.find((item) => item['@type'] === 'BreadcrumbList');
    expect(breadcrumb).toBeDefined();
    const items = breadcrumb!.itemListElement as Array<{ name: string }>;
    const labels = items.map((i) => i.name);
    expect(labels).toContain('Collection ABC');
  });

  it('omits collection from breadcrumb when no collectionCode', () => {
    const letter: Letter = { ...baseLetter, collectionCode: undefined };
    const seo = buildLetterSeo(letter);
    const breadcrumb = seo.jsonLd!.find((item) => item['@type'] === 'BreadcrumbList');
    const items = breadcrumb!.itemListElement as Array<{ name: string }>;
    const labels = items.map((i) => i.name);
    expect(labels).not.toContain(expect.stringContaining('Collection'));
  });

  it('sets modifiedTime from updatedAt', () => {
    const seo = buildLetterSeo(baseLetter);
    expect(seo.modifiedTime).toBe('2024-06-15');
  });
});

// ── buildLetterTitle ─────────────────────────────────────────────────────────

describe('buildLetterTitle', () => {
  it('formats title with sender and recipient', () => {
    const letter = {
      title: 'Fallback',
      metadata: { sender: 'Alice', recipient: 'Bob', date: 'Jan 1, 1940', verified: false },
    } as Letter;
    expect(buildLetterTitle(letter)).toBe('Letter from Alice to Bob, Jan 1, 1940');
  });

  it('formats title with only sender', () => {
    const letter = {
      title: 'Fallback',
      metadata: { sender: 'Alice', date: 'Jan 1, 1940', verified: false },
    } as Letter;
    expect(buildLetterTitle(letter)).toBe('Letter from Alice, Jan 1, 1940');
  });

  it('formats title with only recipient', () => {
    const letter = {
      title: 'Fallback',
      metadata: { recipient: 'Bob', date: 'Jan 1, 1940', verified: false },
    } as Letter;
    expect(buildLetterTitle(letter)).toBe('Letter to Bob, Jan 1, 1940');
  });

  it('falls back to letter.title when no people', () => {
    const letter = {
      title: 'My Letter Title',
      metadata: { verified: false },
    } as Letter;
    expect(buildLetterTitle(letter)).toBe('My Letter Title');
  });

  it('omits date portion when no date', () => {
    const letter = {
      title: 'Fallback',
      metadata: { sender: 'Alice', recipient: 'Bob', verified: false },
    } as Letter;
    expect(buildLetterTitle(letter)).toBe('Letter from Alice to Bob');
  });
});

// ── buildBlogPostSeo ─────────────────────────────────────────────────────────

describe('buildBlogPostSeo', () => {
  const basePost: BlogPost = {
    id: 'post-1',
    slug: 'my-first-post',
    title: 'My First Post',
    excerpt: 'A short excerpt about the post.',
    bodyMarkdown: '## Introduction\n\nThis is the body of the post with **bold** text.',
    status: 'published',
    category: 'field-notes',
    authorDisplayName: 'Jane Doe',
    authorRole: 'editor',
    heroImageUrl: '/uploads/hero.jpg',
    heroImageAlt: 'A nice photo',
    seoTitle: null,
    seoDescription: null,
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: '2024-06-01',
    createdAt: '2024-05-15',
    updatedAt: '2024-06-10',
  };

  it('uses post title when seoTitle is null', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.title).toBe('My First Post');
  });

  it('prefers seoTitle when present', () => {
    const post: BlogPost = { ...basePost, seoTitle: 'SEO Optimized Title' };
    const seo = buildBlogPostSeo(post);
    expect(seo.title).toBe('SEO Optimized Title');
  });

  it('uses excerpt for description when seoDescription is null', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.description).toBe('A short excerpt about the post.');
  });

  it('prefers seoDescription when present', () => {
    const post: BlogPost = { ...basePost, seoDescription: 'Custom SEO desc' };
    const seo = buildBlogPostSeo(post);
    expect(seo.description).toBe('Custom SEO desc');
  });

  it('falls back to stripped markdown when no excerpt or seoDescription', () => {
    const post: BlogPost = { ...basePost, excerpt: null, seoDescription: null };
    const seo = buildBlogPostSeo(post);
    expect(seo.description).toContain('Introduction');
    expect(seo.description).not.toContain('##');
    expect(seo.description).not.toContain('**');
  });

  it('sets ogImage from heroImageUrl', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.ogImage).toBeDefined();
    expect(seo.ogImage).toContain('hero.jpg');
  });

  it('sets imageAlt from heroImageAlt', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.imageAlt).toBe('A nice photo');
  });

  it('falls back imageAlt to post title when heroImageAlt is null', () => {
    const post: BlogPost = { ...basePost, heroImageAlt: null };
    const seo = buildBlogPostSeo(post);
    expect(seo.imageAlt).toBe('My First Post');
  });

  it('sets ogType to article', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.ogType).toBe('article');
  });

  it('sets canonicalPath from slug', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.canonicalPath).toBe('/blog/my-first-post');
  });

  it('sets publishedTime from publishedAt', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.publishedTime).toBe('2024-06-01');
  });

  it('sets modifiedTime from updatedAt', () => {
    const seo = buildBlogPostSeo(basePost);
    expect(seo.modifiedTime).toBe('2024-06-10');
  });

  it('includes BlogPosting JSON-LD with author', () => {
    const seo = buildBlogPostSeo(basePost);
    const posting = seo.jsonLd!.find((item) => item['@type'] === 'BlogPosting');
    expect(posting).toBeDefined();
    const author = posting!.author as { '@type': string; name: string };
    expect(author['@type']).toBe('Person');
    expect(author.name).toBe('Jane Doe');
  });

  it('uses Organization as author when authorDisplayName is null', () => {
    const post: BlogPost = { ...basePost, authorDisplayName: null };
    const seo = buildBlogPostSeo(post);
    const posting = seo.jsonLd!.find((item) => item['@type'] === 'BlogPosting');
    const author = posting!.author as { '@type': string; name: string };
    expect(author['@type']).toBe('Organization');
    expect(author.name).toBe('Voices That Remain');
  });

  it('includes breadcrumb JSON-LD', () => {
    const seo = buildBlogPostSeo(basePost);
    const types = seo.jsonLd!.map((item) => item['@type']);
    expect(types).toContain('BreadcrumbList');
  });
});

// ── buildBlogIndexSeo ────────────────────────────────────────────────────────

describe('buildBlogIndexSeo', () => {
  it('returns "Journal" title for page 1', () => {
    const seo = buildBlogIndexSeo(1);
    expect(seo.title).toBe('Journal');
  });

  it('includes page number in title for page > 1', () => {
    const seo = buildBlogIndexSeo(3);
    expect(seo.title).toBe('Journal - Page 3');
  });

  it('sets canonicalPath to /blog for page 1', () => {
    const seo = buildBlogIndexSeo(1);
    expect(seo.canonicalPath).toBe('/blog');
  });

  it('includes page param in canonicalPath for page > 1', () => {
    const seo = buildBlogIndexSeo(2);
    expect(seo.canonicalPath).toBe('/blog?page=2');
  });

  it('includes CollectionPage JSON-LD', () => {
    const seo = buildBlogIndexSeo(1);
    const types = seo.jsonLd!.map((item) => item['@type']);
    expect(types).toContain('CollectionPage');
  });

  it('includes breadcrumb JSON-LD', () => {
    const seo = buildBlogIndexSeo(1);
    const types = seo.jsonLd!.map((item) => item['@type']);
    expect(types).toContain('BreadcrumbList');
  });

  it('adds page label to breadcrumb for page > 1', () => {
    const seo = buildBlogIndexSeo(3);
    const breadcrumb = seo.jsonLd!.find((item) => item['@type'] === 'BreadcrumbList');
    const items = breadcrumb!.itemListElement as Array<{ name: string }>;
    const labels = items.map((i) => i.name);
    expect(labels).toContain('Page 3');
  });
});

// ── buildNotFoundSeo ─────────────────────────────────────────────────────────

describe('buildNotFoundSeo', () => {
  it('returns "Page Not Found" as title', () => {
    const seo = buildNotFoundSeo();
    expect(seo.title).toBe('Page Not Found');
  });

  it('sets robots to noindex,nofollow', () => {
    const seo = buildNotFoundSeo();
    expect(seo.robots).toBe('noindex,nofollow');
  });

  it('sets canonicalPath to /404', () => {
    const seo = buildNotFoundSeo();
    expect(seo.canonicalPath).toBe('/404');
  });

  it('has no jsonLd', () => {
    const seo = buildNotFoundSeo();
    expect(seo.jsonLd).toBeUndefined();
  });
});

// ── buildBreadcrumbJsonLd ────────────────────────────────────────────────────

describe('buildBreadcrumbJsonLd', () => {
  it('returns BreadcrumbList with correct positions', () => {
    const result = buildBreadcrumbJsonLd([
      { label: 'Home', href: '/' },
      { label: 'Blog', href: '/blog' },
    ]);
    expect(result).toBeDefined();
    expect(result!['@type']).toBe('BreadcrumbList');
    const items = result!.itemListElement as Array<{ position: number; name: string }>;
    expect(items).toHaveLength(2);
    expect(items[0].position).toBe(1);
    expect(items[1].position).toBe(2);
  });

  it('returns undefined when all items lack href', () => {
    const result = buildBreadcrumbJsonLd([{ label: 'Current Page' }]);
    expect(result).toBeUndefined();
  });
});
