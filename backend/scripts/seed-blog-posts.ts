/**
 * Remove legacy placeholder journal entries and seed the initial launch post.
 *
 * Run with: npx tsx scripts/seed-blog-posts.ts
 */

import 'dotenv/config';
import { inArray, like, or } from 'drizzle-orm';
import { db, updatePosts } from '../src/db/index.js';

type SeedPost = {
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMarkdown: string;
  category: string | null;
  authorDisplayName: string | null;
  authorRole: string | null;
  heroImageUrl: string | null;
  heroImageAlt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  publishedAt: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

const legacyMockSlugs = [
  // Current checked-in placeholder seeds.
  slugify('Opening the Harlow Family Correspondence Collection'),
  slugify('What We Learned From Our First Volunteer Transcription Night'),
  slugify('Search Now Understands Partial Names and Nicknames'),
  slugify('Conserving a Water-Damaged 1918 Letter'),
  slugify('Why We Added Collection Notes to the Public Archive'),
  slugify('Index.'),
  slugify('The Box Labeled Misc Turned Out To Be Anything But Miscellaneous'),
  slugify('A Post With No Excerpt No Category and Almost No Framing'),
  slugify('Working Notes Markdown Stress Test'),
  slugify('Drafts Duplicates and Dead Ends Why We Keep Records of Failed Leads'),

  // Earlier placeholder content that was seeded directly into the local DB.
  'a-letter-from-the-trenches-private-hawkins-writes-home',
  'how-we-transcribe-a-look-inside-the-process',
  'the-galusha-conley-letters-a-new-collection-arrives',
  'five-things-we-learned-from-reading-500-letters',
  'when-ink-fades-recovering-text-from-damaged-letters',
  'the-accidental-archive-letters-found-in-library-books',
  'what-a-postmark-can-tell-you-that-a-letter-cannot',
  'our-first-volunteer-transcription-night',
  'preserving-a-water-damaged-1918-letter',
  'why-we-built-a-letter-archive',
] as const;

const seedPosts: SeedPost[] = [
  {
    slug: slugify('Letter Archive Is Live'),
    title: 'Letter Archive Is Live',
    excerpt:
      'Letter Archive is now public: a home for historical correspondence built to preserve original scans, readable transcriptions, and the connections between people, places, and collections.',
    bodyMarkdown: `Letter Archive is now live.

This project started with a simple conviction: personal letters deserve better than a box in the attic, a vague family story, or a few disconnected scans on a hard drive. Letters carry voice, pacing, uncertainty, and the small details that make a life feel real. When they are preserved well, they do more than document history. They let you stand near it.

## What this site is

Letter Archive is a public home for historical correspondence. It is built to do two jobs at the same time:

- preserve the original documents as faithfully as possible
- make them readable, searchable, and explorable without flattening them into database entries

Every letter begins with the document itself. The scan stays central. Around it, the site adds a transcription, structured metadata, and navigational context so a reader can move from one page into a larger network of people, places, and recurring themes.

## What you can do here right now

The first public release is built around discovery.

- browse by collection if you want to stay inside one family, one relationship, or one historical moment
- search across names, places, dates, and remembered phrases
- open a letter and read the scan beside a verified transcription
- move outward from a single document into related people, places, and collections

The goal is not just access. It is orientation. Someone should be able to arrive with a surname, a half-remembered town, or a general curiosity and still find a way in.

## How the archive is built

Behind the public site is a workflow that mixes automation with review.

- AI helps draft transcriptions and structured metadata
- human review keeps the archive accountable when handwriting, dates, or identities are unclear
- entity tracking links people and places across letters so corrections can propagate instead of remaining isolated mistakes

That matters because historical material is messy. Handwriting shifts. Dates are partial. Names repeat. Family stories conflict with the record. Good archive software should help make that material legible without pretending that uncertainty does not exist.

## Why letters

Official records tell you that something happened. Letters show you how it felt while it was happening.

They preserve hesitation, intimacy, logistics, boredom, grief, affection, and the strange texture of ordinary life. They keep the human scale intact. That is what makes them worth preserving carefully and worth presenting in a form that invites slow reading rather than quick extraction.

## What comes next

This launch is the foundation, not the finished form.

The next phase is focused on:

- publishing more collections and more verified material
- improving collection pages so they work as stronger entry points instead of simple containers
- surfacing richer connections between correspondents, places, and recurring topics
- moving toward an experience that feels less like querying a database and more like asking someone who knows the archive well

If you want the best first pass through the site, start with a collection or pick a letter that catches your eye, then follow one person or one place outward. The archive gets interesting quickly when you read it as a web of lives rather than a pile of documents.

This is the first public version of Letter Archive. There is more to build, more to verify, and more correspondence to bring online. But the core idea is here now: a permanent, readable home for letters that would otherwise stay hidden.`,
    category: 'Project Launch',
    authorDisplayName: 'Mason Galusha',
    authorRole: 'Archive Director',
    heroImageUrl: null,
    heroImageAlt: null,
    seoTitle: 'Letter Archive Is Live',
    seoDescription:
      'Letter Archive is now public: a home for historical correspondence with original scans, verified transcriptions, and searchable connections across people, places, and collections.',
    ctaLabel: 'Browse the Collections',
    ctaUrl: '/collections',
    publishedAt: '2026-03-30T14:00:00.000Z',
  },
];

async function main() {
  console.log('Removing legacy placeholder journal entries...\n');

  const deletedPosts = await db
    .delete(updatePosts)
    .where(
      or(
        inArray(updatePosts.slug, [...legacyMockSlugs]),
        like(updatePosts.heroImageUrl, '/mock-blog/%'),
        like(updatePosts.heroImageUrl, '%images.unsplash.com%'),
      ),
    )
    .returning({ slug: updatePosts.slug });

  console.log(`Removed ${deletedPosts.length} legacy placeholder entr${deletedPosts.length === 1 ? 'y' : 'ies'}.\n`);

  console.log(`Seeding ${seedPosts.length} launch journal post...\n`);

  for (const post of seedPosts) {
    const now = new Date();

    await db
      .insert(updatePosts)
      .values({
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        bodyMarkdown: post.bodyMarkdown,
        status: 'published',
        category: post.category,
        authorDisplayName: post.authorDisplayName,
        authorRole: post.authorRole,
        heroImageUrl: post.heroImageUrl,
        heroImageAlt: post.heroImageAlt,
        seoTitle: post.seoTitle,
        seoDescription: post.seoDescription,
        ctaLabel: post.ctaLabel,
        ctaUrl: post.ctaUrl,
        publishedAt: new Date(post.publishedAt),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: updatePosts.slug,
        set: {
          title: post.title,
          excerpt: post.excerpt,
          bodyMarkdown: post.bodyMarkdown,
          status: 'published',
          category: post.category,
          authorDisplayName: post.authorDisplayName,
          authorRole: post.authorRole,
          heroImageUrl: post.heroImageUrl,
          heroImageAlt: post.heroImageAlt,
          seoTitle: post.seoTitle,
          seoDescription: post.seoDescription,
          ctaLabel: post.ctaLabel,
          ctaUrl: post.ctaUrl,
          publishedAt: new Date(post.publishedAt),
          updatedAt: now,
        },
      });

    console.log(`Upserted: ${post.slug}`);
  }

  console.log('\nLaunch journal post seeded successfully.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to seed launch journal post:', error);
    process.exit(1);
  });
