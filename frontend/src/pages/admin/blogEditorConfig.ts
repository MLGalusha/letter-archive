export type MockMediaAsset = {
  id: string;
  label: string;
  src: string;
  alt: string;
  hint: string;
};

export type BlogTemplate = {
  id: string;
  label: string;
  description: string;
  title: string;
  excerpt: string;
  category: string;
  heroImageUrl?: string;
  heroImageAlt?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  bodyMarkdown: string;
};

export const COMMON_BLOG_CATEGORIES = [
  'Archive Progress',
  'Collections',
  'Behind the Scenes',
  'New Features',
  'Field Notes',
  'Research Notes',
  'Preservation',
  'Release Notes',
];

export const MOCK_MEDIA_LIBRARY: MockMediaAsset[] = [
  {
    id: 'dashboard',
    label: 'Archive Dashboard',
    src: '/mock-blog/archive-dashboard.svg',
    alt: 'Mock archive dashboard with collection cards, progress bars, and a recent activity rail.',
    hint: 'Good for launch notes and progress posts.',
  },
  {
    id: 'collection-grid',
    label: 'Collection Browser',
    src: '/mock-blog/collection-browser.svg',
    alt: 'Mock collection browser with filtering controls and editorial image cards.',
    hint: 'Fits collection highlights and discovery stories.',
  },
  {
    id: 'search',
    label: 'Search Workbench',
    src: '/mock-blog/search-workbench.svg',
    alt: 'Mock search interface showing nickname matching, filters, and linked results.',
    hint: 'Useful for feature posts and product updates.',
  },
  {
    id: 'review',
    label: 'Transcription Review',
    src: '/mock-blog/transcription-review.svg',
    alt: 'Mock transcription review surface with manuscript image, transcript pane, and issue callouts.',
    hint: 'Pairs well with process and volunteer workflow posts.',
  },
  {
    id: 'letter-detail',
    label: 'Letter Detail',
    src: '/mock-blog/letter-detail.svg',
    alt: 'Mock public letter detail view with metadata chips, summary, and a large document preview.',
    hint: 'Use when writing about the reading experience.',
  },
  {
    id: 'volunteer',
    label: 'Volunteer Session',
    src: '/mock-blog/volunteer-session.svg',
    alt: 'Mock volunteer session board with timeboxes, sticky notes, and a participation summary.',
    hint: 'Works for behind-the-scenes recaps.',
  },
];

export const BLOG_TEMPLATES: BlogTemplate[] = [
  {
    id: 'collection-highlight',
    label: 'Collection Highlight',
    description: 'A long-form editorial story with a lede, image break, context table, and final CTA.',
    title: 'Opening a Collection With More Questions Than Answers',
    excerpt: 'Use this when a group of letters needs narrative framing, context, and a clear invitation to explore.',
    category: 'Collections',
    heroImageUrl: '/mock-blog/collection-browser.svg',
    heroImageAlt: 'Mock collection browser with archival cards and filters.',
    ctaLabel: 'Browse the Collection',
    ctaUrl: '/collections',
    bodyMarkdown: `## Why this group matters

Start with a few sharp sentences that explain what changed, what became public, or what readers can now do that they could not do before.

![Mock collection browser](/mock-blog/collection-browser.svg)

## What the material includes

- a quick sense of date range
- the kinds of documents inside
- what feels distinctive about the voices or subject matter
- what still needs work before the collection feels fully settled

## What we know today

| Question | Current answer |
| --- | --- |
| Provenance | Add the short provenance note here. |
| Date coverage | Explain the current span. |
| Gaps | Note what is missing or still uncertain. |

## What to look for first

Write a compact guide for readers who are arriving fresh.

> Add one vivid line or quote that captures the mood of the collection.

## What happens next

Close with a concrete next step, either for readers, volunteers, or internal processing.`,
  },
  {
    id: 'feature-note',
    label: 'Feature Note',
    description: 'A product-style update with before/after framing, examples, and rollout notes.',
    title: 'A Search Improvement That Removes One Common Point of Friction',
    excerpt: 'Best for shipping notes, search improvements, and public-facing product updates.',
    category: 'New Features',
    heroImageUrl: '/mock-blog/search-workbench.svg',
    heroImageAlt: 'Mock search workbench showing filters and matched results.',
    ctaLabel: 'Try the Feature',
    ctaUrl: '/',
    bodyMarkdown: `## What changed

State the change in plain language first.

![Mock search workbench](/mock-blog/search-workbench.svg)

## Where it helps

- name matching
- browse speed
- confidence when scanning results

## Before and after

| Scenario | Before | After |
| --- | --- | --- |
| Incomplete query | Explain the old behavior. | Explain the improved behavior. |
| Family nickname | Explain the old behavior. | Explain the improved behavior. |

## Rollout notes

Add one short paragraph about limitations, follow-up work, or what still needs tuning.`,
  },
  {
    id: 'field-note',
    label: 'Field Note',
    description: 'A flexible short-to-medium post for preservation, cataloging, or editorial notes.',
    title: 'A Small Workflow Adjustment That Paid Off Immediately',
    excerpt: 'Use for practical notes from the archive floor without making the post feel unfinished.',
    category: 'Field Notes',
    heroImageUrl: '/mock-blog/transcription-review.svg',
    heroImageAlt: 'Mock transcription review surface with two-column workflow.',
    ctaLabel: 'Read More About the Process',
    ctaUrl: '/about',
    bodyMarkdown: `## The moment

Open with the practical situation that made the note worth writing.

## What changed in the workflow

1. Describe the first shift.
2. Describe the second shift.
3. Describe the outcome.

## Why it mattered

Add a short explanation of what became easier, clearer, or more reliable.

![Mock review surface](/mock-blog/transcription-review.svg)

## Keep in mind

> Leave yourself one honest note about the limitation or tradeoff here.`,
  },
  {
    id: 'short-note',
    label: 'Short Note',
    description: 'A concise update that still feels designed rather than empty.',
    title: 'A Brief Note From This Week in the Archive',
    excerpt: 'For quick updates that should stay clean, readable, and properly framed.',
    category: 'Behind the Scenes',
    ctaLabel: 'Follow the Archive',
    ctaUrl: '/blog',
    bodyMarkdown: `A short note works best when it still has a clear reason to exist.

## The point

Write one paragraph that explains the update without over-expanding it.

## One useful takeaway

- add the one thing a reader should remember

## Next

End with a sentence that points people to the next action or next question.`,
  },
];

export const QUICK_INSERT_SNIPPETS = [
  {
    id: 'section',
    label: 'Section',
    markdown: '\n## Section heading\n\nWrite the next section here.\n',
  },
  {
    id: 'pull-quote',
    label: 'Pull Quote',
    markdown: '\n> Add the one sentence worth pausing on.\n\n',
  },
  {
    id: 'key-points',
    label: 'Key Points',
    markdown: '\n## Key points\n\n- First point\n- Second point\n- Third point\n',
  },
  {
    id: 'table',
    label: 'Table',
    markdown: '\n| Column | Detail |\n| --- | --- |\n| Add | values |\n',
  },
  {
    id: 'divider',
    label: 'Divider',
    markdown: '\n---\n',
  },
];
