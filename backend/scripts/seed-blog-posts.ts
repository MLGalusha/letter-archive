/**
 * Seed richer mock blog posts for local development.
 *
 * Run with: npx tsx scripts/seed-blog-posts.ts
 */

import 'dotenv/config';
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

const mockAssets = {
  dashboard: '/mock-blog/archive-dashboard.svg',
  collection: '/mock-blog/collection-browser.svg',
  search: '/mock-blog/search-workbench.svg',
  review: '/mock-blog/transcription-review.svg',
  letter: '/mock-blog/letter-detail.svg',
  volunteers: '/mock-blog/volunteer-session.svg',
};

const seedPosts: SeedPost[] = [
  {
    slug: slugify('Opening the Harlow Family Correspondence Collection'),
    title: 'Opening the Harlow Family Correspondence Collection',
    excerpt:
      'A newly processed run of letters reveals a family story that moves from practical household notes to wartime uncertainty without losing its intimate scale.',
    bodyMarkdown: `We have published the first public batch from the Harlow Family Correspondence Collection, and it is the kind of material that rewards slow reading.

The group stretches across three generations, but it does not feel like a neat family chronology. It feels lived in. One page tracks a train connection, another apologizes for delayed payment, and another asks whether a ring can be resized before a wedding that may or may not happen on time. That range is exactly what makes the collection valuable: the letters hold ordinary administration and emotional pressure in the same hand.

![Mock collection browser showing the Harlow Family collection](${mockAssets.collection})

## What is in the first release

The public batch is intentionally wide rather than exhaustive. We wanted readers to experience the shape of the collection first.

- short postcards written while traveling
- folded multi-page letters with domestic logistics
- condolence notes that shift the tone of the entire run
- wartime updates written under visible time pressure
- later annotations that help us trace how the family preserved the papers

## Why this collection matters

What makes this group especially useful for the archive is not rarity by itself. It is range. The same people reappear under different emotional temperatures. A reader can move from flirtation to bookkeeping to fear in a span of a few pages and see how quickly historical feeling changes form.

That gives us an opportunity to build a public collection page that is not just a container for scans. It can become a guided entry point into the social world of the letters.

## Processing status

| Area | Current status | Notes |
| --- | --- | --- |
| Scanning | Complete for the opening batch | A second carton still needs recapture. |
| Basic metadata | Complete | Names and dates are public. |
| Full relationships | In progress | Family links are still being verified. |
| Collection notes | Published | Provenance and arrangement notes are now visible. |

## Where to begin as a reader

If you want a first path through the material, start with the 1918 letters. They move quickly between mundane planning and a much larger sense of instability. That makes the archive legible immediately, even before you understand every name.

Then read backward. The earlier notes are smaller and less dramatic, but they give the later urgency its weight.

## What comes next

The next pass on this collection will focus on relationship tagging, a clearer family timeline, and better surfacing of documents that were obviously handled as a group even when their dates are uncertain. This is also the batch we are using to test more reader-facing context cards, so the public presentation will continue to evolve as the archive grows.`,
    category: 'Collections',
    authorDisplayName: 'Mason Galusha',
    authorRole: 'Archive Director',
    heroImageUrl: mockAssets.collection,
    heroImageAlt: 'Mock collection browser with editorial cards for archival collections.',
    seoTitle: 'Opening the Harlow Family Correspondence Collection',
    seoDescription:
      'Letter Archive has opened the Harlow Family Correspondence Collection with postcards, household notes, and wartime letters.',
    ctaLabel: 'Browse Collections',
    ctaUrl: '/collections',
    publishedAt: '2026-03-22T14:00:00.000Z',
  },
  {
    slug: slugify('What We Learned From Our First Volunteer Transcription Night'),
    title: 'What We Learned From Our First Volunteer Transcription Night',
    excerpt:
      'Our first group transcription session was intentionally small, but it showed exactly where people gain confidence and where the interface still needs to get out of their way.',
    bodyMarkdown: `Our first volunteer transcription night was small on purpose. We wanted less of a launch event and more of a listening session.

Instead of asking whether people liked the archive in the abstract, we asked them to sit with real pages, real uncertainty, and real moments where one person saw a name that another person could not yet decode. That produced far better information than a survey would have.

![Mock volunteer session board with notes and timeboxes](${mockAssets.volunteers})

## Three lessons were immediate

### 1. Names are easier in conversation

Once one person notices a surname pattern, the rest of the page begins to open. That means collaborative review is not just socially nice; it is operationally useful.

### 2. Margins do real work

Volunteers consistently spotted dates, place names, and later corrections in the margins. An OCR-first workflow can catch some of that, but people still notice relational context faster than automated extraction does.

### 3. Confidence labels reduce friction

People were far more willing to contribute when they could say “probably” without feeling like they had failed. The moment uncertainty becomes visible and acceptable, participation improves.

## What we are changing

| Observation | Product response |
| --- | --- |
| Volunteers needed a lower-stakes way to mark guesses | We are keeping uncertainty visible instead of flattening it. |
| People used conversation to decode names | We are exploring better notes around repeated surnames and household context. |
| Supporting context mattered more than expected | We are testing clearer collection-level notes and relationship hints. |

## What surprised us

The most interesting surprise was not accuracy. It was pace. People moved faster once they understood the document socially, not just visually. A page becomes easier when someone can explain who is writing, why they sound impatient, and what kind of reply they expected.

That is a useful reminder for software design. Better archive tools do not just help people type text faster. They reduce the time it takes to understand what kind of text is in front of them.

## Next session

The next volunteer night will use a tighter set of pages, a clearer confidence model, and more explicit prompts for what to note when the transcript is uncertain but the context is visible.`,
    category: 'Behind the Scenes',
    authorDisplayName: 'Elena Ward',
    authorRole: 'Volunteer Coordinator',
    heroImageUrl: mockAssets.volunteers,
    heroImageAlt: 'Mock volunteer transcription session board with sticky-note findings.',
    seoTitle: null,
    seoDescription: null,
    ctaLabel: 'Support the Project',
    ctaUrl: '/support',
    publishedAt: '2026-03-18T15:30:00.000Z',
  },
  {
    slug: slugify('Search Now Understands Partial Names and Nicknames'),
    title: 'Search Now Understands Partial Names and Nicknames',
    excerpt:
      'A search update makes it easier to recover letters when the archive contains initials, abbreviations, and family nickname patterns instead of clean canonical forms.',
    bodyMarkdown: `We shipped a search improvement that helps the archive recover more letters from imperfect queries.

For readers, the visible effect is simple: you can now search the way people actually remember historical names, not only the way records have been normalized.

![Mock search workbench showing nickname and partial-name matches](${mockAssets.search})

## What now works better

- partial given names
- common nickname forms
- initials that repeat within a collection
- surname fragments when spelling is unstable across documents

## Before and after

| Query style | Previous behavior | Current behavior |
| --- | --- | --- |
| \`Liz\` | Often missed letters normalized under \`Elizabeth\` | Surfaces likely matches earlier |
| \`J. Haml\` | Required a near-perfect surname | Handles fragments and repeated initials |
| nickname + place | Produced thin result sets | Better at combining soft clues |

This does not change the canonical data model. It changes how tolerant the search layer is when it interprets user input.

## Why that matters

Archival users rarely arrive with the “correct” string. They arrive with partial memory, family lore, or a guess copied from an envelope. Search should meet that reality instead of punishing it.

The better the archive becomes at handling incomplete queries, the less often a user mistakes absence of evidence for evidence of absence.

## What still needs work

This first pass is strongest with common nickname families and repeated patterns inside already-processed collections. It is not a magic fix for all variant spellings, and it does not yet solve cases where two people in the same collection share overlapping initials.

That is the next tuning pass.`,
    category: 'New Features',
    authorDisplayName: 'Mason Galusha',
    authorRole: 'Archive Director',
    heroImageUrl: mockAssets.search,
    heroImageAlt: 'Mock search workbench with query helpers and result groups.',
    seoTitle: 'Letter Archive Search Update',
    seoDescription:
      'The archive search now handles nicknames, initials, and partial names more gracefully.',
    ctaLabel: 'Try Search',
    ctaUrl: '/',
    publishedAt: '2026-03-12T13:00:00.000Z',
  },
  {
    slug: slugify('Conserving a Water-Damaged 1918 Letter'),
    title: 'Conserving a Water-Damaged 1918 Letter',
    excerpt:
      'One of this month’s most fragile items arrived with tide lines, transferred ink, and a center fold so thin we had to slow the entire workflow down around it.',
    bodyMarkdown: `A recently processed 1918 letter arrived in the kind of condition that changes the room immediately.

The paper had clear water damage, the center fold was thinning, and one section had transferred ink from another page after years of pressure. Even before any conservation decision was made, the item forced us to narrow the workflow. Fewer hands, more documentation, slower capture.

![Mock letter detail view with a large document preview and metadata context](${mockAssets.letter})

## What the damage looked like

- tide lines at the outer edge
- adhesive staining from an older repair
- transferred ink near the fold
- soft paper failure at the most handled points

## What we chose not to do

We did not attempt dramatic intervention. In cases like this, restraint is often more honest than visual improvement. The goal was stabilization, not cosmetic recovery.

## What we did do

1. flattened only where safe
2. rehoused the item
3. documented the unrecoverable damage
4. improved capture conditions before digitization

## Why that matters publicly

Even when a letter remains imperfect, careful handling can make it readable enough to preserve its historical value without pretending the damage never happened. That distinction matters for readers. They should be able to see both the content and the condition that shaped its survival.

The archive should not quietly edit away the physical evidence of time.`,
    category: 'Preservation',
    authorDisplayName: 'Dana Brooks',
    authorRole: 'Collections Assistant',
    heroImageUrl: mockAssets.letter,
    heroImageAlt: 'Mock public letter detail view with metadata and a manuscript preview.',
    seoTitle: null,
    seoDescription: null,
    ctaLabel: 'Read About the Project',
    ctaUrl: '/about',
    publishedAt: '2026-03-05T16:15:00.000Z',
  },
  {
    slug: slugify('Why We Added Collection Notes to the Public Archive'),
    title: 'Why We Added Collection Notes to the Public Archive',
    excerpt:
      'Context matters. A short note about provenance, arrangement, or uncertainty can change how a reader understands an entire run of letters.',
    bodyMarkdown: `Collection notes are now easier to surface alongside archived materials.

At first glance this looks like a modest product change. In practice it changes how honestly the archive can speak. Letters do not arrive from nowhere, and they do not survive in a condition of perfect explanation.

## Readers often need to know

- who preserved the material
- how the group was arranged before we encountered it
- whether pages are missing
- whether dates were inferred from envelopes or internal references

## Why those notes belong in public

Those notes do not replace the letters. They keep us honest about what we know, what we suspect, and what still needs research. A clean transcription without context can give readers a false sense of certainty.

![Mock archive dashboard with collection-note cards in the activity feed](${mockAssets.dashboard})

## What the change unlocks

The most important result is interpretive. Readers can now see more of the frame around the letters themselves, which makes the archive feel less like a vault and more like a working record of preservation and research.`,
    category: 'Collections',
    authorDisplayName: 'Mason Galusha',
    authorRole: 'Archive Director',
    heroImageUrl: mockAssets.dashboard,
    heroImageAlt: 'Mock dashboard with collection-note activity cards.',
    seoTitle: null,
    seoDescription: null,
    ctaLabel: 'Explore the Collections',
    ctaUrl: '/collections',
    publishedAt: '2026-02-24T12:00:00.000Z',
  },
  {
    slug: slugify('Index.'),
    title: 'Index.',
    excerpt: 'A deliberately tiny post to verify that short titles and compact copy still feel intentional.',
    bodyMarkdown: `Sometimes the smallest record is still worth keeping.

This post exists to verify that extremely short titles, short excerpts, and compact bodies do not break the blog layout.`,
    category: 'Field Notes',
    authorDisplayName: 'System Check',
    authorRole: 'Mock Content',
    heroImageUrl: null,
    heroImageAlt: null,
    seoTitle: 'Index.',
    seoDescription: 'A compact mock post used to verify short blog content.',
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: '2026-02-14T09:00:00.000Z',
  },
  {
    slug: slugify('The Box Labeled Misc Turned Out To Be Anything But Miscellaneous'),
    title: 'The Box Labeled Misc Turned Out To Be Anything But Miscellaneous',
    excerpt:
      'A vague storage label led to correspondence fragments, enclosure scraps, pressed flowers, duplicated receipts, and one of the most useful archival puzzles in the room.',
    bodyMarkdown: `The storage label simply read “Misc.”

That usually means the real description was deferred years ago and never restored. In this case the box contained a fractured but strangely coherent group of materials: correspondence fragments, enclosure scraps, two undated receipts, one pressed flower packet, and a note explaining that several letters had already been moved to another folder “for safekeeping.”

## Why this matters

Material like this breaks clean narrative habits. It refuses summary. But it also produces the best research questions because the disorder is part of the evidence.

## What the box actually taught us

- family filing logic changed over time
- some materials were clearly kept together long after their dates diverged
- “miscellaneous” often means “important, but unresolved”

![Mock collection browser highlighting a mixed-material box](${mockAssets.collection})

Long titles should wrap well. Long excerpts should remain readable. Dense but odd material should still feel composed on the public page. That is what this post is here to test.`,
    category: 'Research Notes',
    authorDisplayName: 'Mason Galusha',
    authorRole: 'Archive Director',
    heroImageUrl: mockAssets.collection,
    heroImageAlt: 'Mock collection browser surfacing a mixed archival box.',
    seoTitle: null,
    seoDescription: null,
    ctaLabel: 'See the Archive',
    ctaUrl: '/',
    publishedAt: '2026-02-02T18:20:00.000Z',
  },
  {
    slug: slugify('A Post With No Excerpt No Category and Almost No Framing'),
    title: 'A Post With No Excerpt, No Category, and Almost No Framing',
    excerpt: null,
    bodyMarkdown: `This is an intentionally sparse mock post.

It has no excerpt, no category, no author, and no call to action.

If the template still feels composed and legible, the empty-state handling is doing its job.`,
    category: null,
    authorDisplayName: null,
    authorRole: null,
    heroImageUrl: null,
    heroImageAlt: null,
    seoTitle: null,
    seoDescription: null,
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: '2026-01-28T11:10:00.000Z',
  },
  {
    slug: slugify('Working Notes Markdown Stress Test'),
    title: 'Working Notes: Markdown Stress Test',
    excerpt:
      'A formatting-heavy mock post with headings, tables, blockquotes, inline code, and mock images to exercise the public detail template.',
    bodyMarkdown: `## Purpose

This entry exists to exercise the markdown renderer with a wider range of common patterns than the earlier mock content covered.

### Checklist

- heading hierarchy
- unordered lists
- ordered lists
- blockquotes
- inline code like \`letter_id\`
- data tables
- inline images

> Good archive software should handle tidy prose and messy notes with equal patience.

### Inline image

![Mock dashboard used as an inline article figure](${mockAssets.dashboard})

### Sequence

1. Scan the item.
2. Capture the basic metadata.
3. Record uncertainty instead of hiding it.
4. Make the public presentation reflect what is known and what is not.

### Snapshot table

| Signal | Expected outcome |
| --- | --- |
| Short post | Should still feel composed |
| Long section heading | Should wrap without breaking rhythm |
| Table content | Should remain readable on the page |
| Inline image | Should sit naturally inside the article flow |

### Closing note

If this post looks clean in the public view, the renderer is in much better shape than it was when the mock content first went in.`,
    category: 'New Features',
    authorDisplayName: 'System Check',
    authorRole: 'Mock Content',
    heroImageUrl: null,
    heroImageAlt: null,
    seoTitle: 'Markdown Stress Test',
    seoDescription: 'A mock post that exercises markdown rendering in the blog detail template.',
    ctaLabel: 'View the Homepage',
    ctaUrl: '/',
    publishedAt: '2026-01-19T10:45:00.000Z',
  },
  {
    slug: slugify('Drafts Duplicates and Dead Ends Why We Keep Records of Failed Leads'),
    title: 'Drafts, Duplicates, and Dead Ends: Why We Keep Records of Failed Leads',
    excerpt:
      'Not every research lead resolves cleanly, and this longer mock essay is designed to test denser prose, deeper sectioning, and a more reflective editorial tone.',
    bodyMarkdown: `Archives are full of productive failures.

Sometimes the name on an envelope does not match the letter inside. Sometimes two family stories point to the same person and still refuse to reconcile. Sometimes an item is copied so many times that provenance becomes its own puzzle. Those failures are not noise around the record. They are part of the record.

## Why we keep the failed leads

We keep those unresolved paths because they document the boundaries of our certainty. A public archive that only shows the polished conclusion risks hiding the actual labor that made the conclusion possible.

That matters for readers. It matters for future staff. And it matters for anyone trying to understand why a clean public record often sits on top of a messier research trail.

## What a dead end can preserve

- a discarded name variant
- evidence that two documents were once handled together
- a note from an earlier researcher explaining a path that no longer seems likely
- the exact place where the record stops being firm

![Mock transcription review surface that captures unresolved notes](${mockAssets.review})

## Why this belongs in public-facing software

Not every failed lead should be foregrounded, but the system should be able to hold it without embarrassment. Readers benefit when an archive can say “we are not sure” in a way that still feels precise.

That is one reason the blog matters. It lets us surface the thinking around the archive, not just the polished artifacts. Some of the most important archival work happens in the space between a promising clue and a confirmed fact.

## Clean records still have scaffolding

What looks settled from the outside is often supported by discarded drafts, duplicate names, and temporary folders whose labels made sense only to one person at one moment in time. Good software should not erase that scaffolding from internal workflows, and good public writing should occasionally acknowledge that it exists.

This mock post is here to make sure denser prose still reads comfortably in the public blog layout and that a reflective essay can sit beside shorter operational notes without the template collapsing into sameness.`,
    category: 'Archive Progress',
    authorDisplayName: 'Dana Brooks',
    authorRole: 'Collections Assistant',
    heroImageUrl: mockAssets.review,
    heroImageAlt: 'Mock transcription review interface with unresolved note cards.',
    seoTitle: null,
    seoDescription: null,
    ctaLabel: 'Support the Archive',
    ctaUrl: '/support',
    publishedAt: '2026-01-08T17:05:00.000Z',
  },
];

async function main() {
  console.log(`Seeding ${seedPosts.length} mock blog posts...\n`);

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

  console.log('\nMock blog posts seeded successfully.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to seed mock blog posts:', error);
    process.exit(1);
  });
