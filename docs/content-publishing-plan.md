# Content Publishing Plan

Last updated: March 23, 2026

## Purpose

This document captures the recommended approach for adding admin-managed public content to the Letter Archive site.

The user clarified that the new "blog" is not meant to be a general editorial magazine. Its purpose is to:

- update the public on progress building the web app
- explain what has changed
- explain why changes matter
- preview what is coming next
- reinforce that the archive is active, growing, and worth revisiting

Because of that, the recommended public-facing concept is `Updates`, not `Blog`.

## Core Product Recommendation

Treat this as a lightweight publishing system for the archive, not a generic CMS and not a developer changelog.

Recommended public labels:

- `Updates`
- `Archive Updates`
- `Building the Archive`

Recommended admin label:

- `Content`
- or `Publishing`

The best fit is:

- public side: `Updates`
- admin side: `Content`

## Why `Updates` Fits Better Than `Blog`

`Blog` is broad and usually implies ongoing editorial across many topics.

This project's actual need is narrower:

- project progress
- archive growth
- feature rollouts
- workflow improvements
- contributor-facing trust-building

`Updates` sets the right expectation. It tells visitors:

- this site is active
- the archive is evolving
- there is a reason to come back

It also avoids the risk of making the site feel like a startup marketing site instead of a historical archive.

## Primary Product Goals

### Public goals

- give visitors proof the archive is alive and improving
- create a reason for repeat visits
- connect software updates back to archive value
- surface featured archival material in a human, engaging way
- increase trust for donors, contributors, and researchers

### Admin goals

- let admins publish updates without touching code
- let admins edit About, Contact, and Support copy
- let admins control a homepage featured letter
- preserve design consistency and avoid layout drift

## Existing Codebase Context

### Public routes

The public route tree currently includes:

- `/`
- `/about`
- `/contact`
- `/support`
- `/collections`
- `/collections/:collectionCode`

Reference:

- [frontend/src/App.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/App.tsx)

Important note:

- `/explore` is linked from the About page but is not currently wired in the router.
- `ExplorePage.tsx` already exists, so public navigation currently has at least one broken or incomplete discovery path.

References:

- [frontend/src/App.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/App.tsx)
- [frontend/src/pages/AboutPage.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/pages/AboutPage.tsx)
- [frontend/src/pages/ExplorePage.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/pages/ExplorePage.tsx)

### Current public content patterns

The About, Support, and Contact pages are currently hand-authored React pages with strong section structure and custom layout.

They are not generic rich-text pages. They are carefully composed landing pages with:

- hero sections
- quotes
- cards
- CTAs
- structured content blocks

References:

- [frontend/src/pages/AboutPage.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/pages/AboutPage.tsx)
- [frontend/src/pages/SupportPage.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/pages/SupportPage.tsx)
- [frontend/src/pages/ContactPage.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/pages/ContactPage.tsx)

### Current homepage behavior

The homepage is currently search-first and archive-list-first.

That is useful for researchers and power users, but it is not yet optimized for:

- emotional engagement
- proof of project momentum
- return visits
- curated discovery

Reference:

- [frontend/src/pages/HomePage.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/pages/HomePage.tsx)

### Current admin navigation

The admin sidebar is operationally focused:

- dashboard
- upload
- processing
- notes
- usage
- notifications
- settings

There is no admin publishing/content area yet.

Reference:

- [frontend/src/components/AdminSidebar/AdminSidebar.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/components/AdminSidebar/AdminSidebar.tsx)

### Current settings system

The project already has a site-settings key/value mechanism used for small public settings such as:

- site title
- site description
- donation URLs
- contact emails

References:

- [frontend/src/hooks/useSiteSettings.ts](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/hooks/useSiteSettings.ts)
- [backend/src/routes/index.ts](/Users/masongalusha/Workspace/projects/letter-archive/backend/src/routes/index.ts)
- [backend/src/routes/admin/settings.ts](/Users/masongalusha/Workspace/projects/letter-archive/backend/src/routes/admin/settings.ts)
- [backend/src/db/schema.ts](/Users/masongalusha/Workspace/projects/letter-archive/backend/src/db/schema.ts)

This mechanism is appropriate for:

- short scalar values
- small configuration

It is not the right long-term system for:

- update posts
- slugs
- drafts
- scheduling
- rich page section content
- featured records

## Product Decisions

### 1. Public content type should be `Updates`

Use `Updates` instead of `Blog`.

Reason:

- better matches purpose
- lowers expectation of broad editorial publishing
- keeps focus on archive progress
- feels more honest and project-specific

### 2. The archive remains the main attraction

The new updates system should support the archive, not compete with it.

Reason:

- the core public value is the letters
- updates are a trust and retention layer
- the site should not drift toward "software product marketing"

### 3. Homepage should be the main engagement hub

The homepage should remain the primary landing page and gain curated content modules.

Reason:

- it is the highest-value public real estate
- it is the best place to combine discovery, proof of freshness, and emotional hooks
- it is where a featured letter will have the most impact

### 4. Featured letter should be a first-class public element

The site should include one admin-controlled featured letter slot.

Reason:

- it provides a human, emotional entry point
- it makes the archive feel alive
- it gives updates something tangible to connect to
- it supports support/donation storytelling

### 5. About, Contact, and Support should be editable but structured

These pages should be admin-editable without becoming unstructured WYSIWYG pages.

Reason:

- their current layouts are intentionally designed
- a raw freeform editor will cause visual drift and inconsistency
- structured section fields preserve style while allowing copy changes

## Recommended Public Experience

### Homepage

Recommended order:

1. existing search/discovery hero
2. featured letter
3. archive browsing or collection discovery
4. latest update
5. support CTA

Reasoning:

- search stays prominent for archive-oriented users
- featured letter adds emotional engagement early
- latest update proves freshness without overpowering the archive
- support CTA lands better after visitors understand the value

### Updates index page

Create a public `/updates` page.

This page should:

- list published updates newest first
- show featured image
- show title
- show excerpt
- show date
- show author
- optionally show category

This page is the return-visit surface for project progress.

### Update detail page

Create a public `/updates/:slug` page.

This page should:

- show clear title
- show author/byline
- show published date and optionally updated date
- show hero image
- render body content cleanly
- show related letter or collection links
- include one clear CTA at the end

### Navigation

Add `Updates` to:

- header nav
- footer nav

References:

- [frontend/src/components/Header/Header.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/components/Header/Header.tsx)
- [frontend/src/components/Footer/Footer.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/components/Footer/Footer.tsx)

## Featured Letter Recommendation

### Best placement

Primary:

- homepage

Secondary:

- related module on update pages

Optional tertiary:

- a small support-page module showing what donations preserve

### Why the homepage is best

- highest visibility
- strongest emotional hook
- easiest way to bridge archive content and updates
- gives first-time visitors a concrete example immediately

### Why About, Contact, and Support are not the primary home

- About is explanatory, not timely
- Contact is task-oriented
- Support is conversion-oriented

Those pages can reference a featured letter, but they should not be the main featured-letter destination.

## Recommended Admin Information Architecture

Add a new admin sidebar item:

- `Content`

Inside `Content`, use tabs or sub-sections:

- `Overview`
- `Pages`
- `Updates`
- `Featured`

### Overview

Should display:

- current featured letter
- latest published update
- draft count
- scheduled count
- quick actions

### Pages

Should allow editing:

- About
- Contact
- Support

### Updates

Should allow:

- create new update
- edit draft
- preview
- publish
- unpublish
- schedule
- browse past updates

### Featured

Should allow:

- choose featured letter
- add custom label
- add short intro
- add CTA text
- set related update
- optionally set start/end dates

## Editing Model For Static Pages

Do not implement About, Contact, and Support as one giant rich-text body field.

Use structured section fields.

### About page fields

Recommended fields:

- hero kicker
- hero heading
- hero subtitle
- featured quote
- why-it-matters paragraph
- process section heading
- process steps 1 to 4
- contribute card heading/body/CTA
- research card heading/body/CTA
- closing CTA text

Dynamic values should remain code/data driven where appropriate:

- collection count
- letter count

### Support page fields

Recommended fields:

- hero kicker
- hero heading
- hero subtitle
- quote
- support intro paragraph
- impact card copy
- donation section heading
- one-time card copy
- monthly card copy
- non-monetary card copy
- thank-you text

Dynamic values should remain settings driven:

- one-time donation URL
- monthly donation URL

### Contact page fields

Recommended fields:

- hero kicker
- hero heading
- hero subtitle
- general contact intro
- contribute card copy
- research card copy
- volunteer card copy
- lower CTA text

Dynamic values should remain settings driven:

- contact email addresses

## Update Post Editorial Model

The updates stream should not feel like raw internal patch notes.

Each update should translate implementation work into reader-facing meaning.

Every post should answer:

- what changed
- why it matters
- what the public can do with it now
- what is coming next

### Recommended update structure

- title
- excerpt
- intro summary
- what changed
- why it matters
- archive spotlight
- what is next
- CTA

### Good update topics

- new archive browsing capability
- improvements to transcription quality
- newly published collection milestones
- new search/discovery tools
- review workflow improvements that improve public quality
- contributor process improvements

### Weak update topics

- internal refactors with no public consequence
- implementation details with no user benefit
- purely technical language without archive relevance

## Recommended Update Post Fields

Use a dedicated content type with these fields:

- `title`
- `slug`
- `excerpt`
- `status`
- `author_display_name`
- `author_role`
- `published_at`
- `updated_at`
- `hero_image_url`
- `hero_image_alt`
- `body_markdown`
- `category`
- `seo_title`
- `seo_description`
- `related_letter_ids`
- `related_collection_codes`
- `cta_label`
- `cta_url`

Recommended statuses:

- `draft`
- `scheduled`
- `published`

Recommended initial categories:

- `Archive Progress`
- `New Features`
- `Collections`
- `Behind the Scenes`

## Authoring Format Recommendation

Use Markdown or a constrained rich-text format for update bodies.

Do not reuse the current `DynamicEditor` as the main update editor.

Reason:

- `DynamicEditor` is designed for transcription workflows and line-fitting behavior
- update authoring needs editorial formatting, not transcription preservation

Reference:

- [frontend/src/components/common/DynamicEditor.tsx](/Users/masongalusha/Workspace/projects/letter-archive/frontend/src/components/common/DynamicEditor.tsx)

## Data Model Recommendation

Do not store posts or structured page content in the existing `site_settings` table.

Add dedicated entities.

Recommended tables:

- `content_pages`
- `update_posts`
- `feature_slots`

### `content_pages`

Suggested fields:

- `id`
- `slug`
- `title`
- `content_json`
- `status`
- `updated_at`
- `updated_by`

Use for:

- about
- contact
- support

### `update_posts`

Suggested fields:

- `id`
- `slug`
- `title`
- `excerpt`
- `body_markdown`
- `status`
- `category`
- `author_display_name`
- `author_role`
- `hero_image_url`
- `hero_image_alt`
- `seo_title`
- `seo_description`
- `published_at`
- `updated_at`
- `created_at`

Optional related-content structure:

- junction table to related letters
- junction table to related collections

### `feature_slots`

Suggested fields:

- `key`
- `content_type`
- `content_id`
- `label`
- `intro_text`
- `cta_label`
- `cta_url`
- `starts_at`
- `ends_at`
- `updated_at`

Initial usage:

- homepage featured letter
- homepage latest update override if needed later

## API Recommendation

### Public endpoints

Recommended endpoints:

- `GET /content/public/pages/:slug`
- `GET /updates`
- `GET /updates/:slug`
- `GET /features/public`

### Admin endpoints

Recommended endpoints:

- `GET /admin/content/pages`
- `PUT /admin/content/pages/:slug`
- `GET /admin/updates`
- `POST /admin/updates`
- `GET /admin/updates/:id`
- `PUT /admin/updates/:id`
- `POST /admin/updates/:id/publish`
- `POST /admin/updates/:id/unpublish`
- `GET /admin/features`
- `PUT /admin/features/:key`

## Route Recommendation

### Public routes

Add:

- `/updates`
- `/updates/:slug`

### Admin routes

Add:

- `/admin/content`
- optional deeper routes later such as `/admin/content/updates/:id`

## Content and UX Writing Rules

### Updates should be written for the public

Use language that explains public value.

Example:

Weak:

- "Refactored metadata review pipeline"

Better:

- "We improved review tools so published letters can be checked faster and more accurately"

### Titles should be descriptive

Avoid vague or clever titles.

Preferred style:

- "New collection browsing improvements are now live"
- "What we improved in transcription review this month"
- "We just published more letters and made them easier to explore"

### Every update should have a CTA

Good CTA types:

- browse letters
- read the featured letter
- explore collections
- support the archive
- contact us about contributing letters

### No public comments in phase 1

Reason:

- moderation overhead
- low early-stage value
- easier to maintain
- better to direct interaction through Contact or Support flows initially

## SEO and Discoverability Requirements

Each update page should have:

- unique page title
- meta description based on excerpt
- canonical URL
- article structured data
- Open Graph metadata
- clear author/byline
- published date
- optional updated date

Each update should also link internally to:

- related letters
- related collections
- support page when appropriate

## Why This Strategy Is Supported By External Research

The following findings informed this plan:

- Google recommends people-first content with original value, descriptive headings/titles, and trust signals such as sourcing and author information.
- Google recommends article metadata such as headline, image, author, and publish date for article pages.
- GOV.UK guidance emphasizes short sentences, meaningful headings, clear titles, excerpts, featured images, end-of-post CTAs, and named authors.
- Europeana uses story-led editorial to connect audiences to cultural heritage content and explicitly treats stories, exhibitions, and galleries as engagement tools.
- Europeana reporting shows meaningful traffic and satisfaction on editorial content, indicating that story-driven content can materially support engagement on archive-like platforms.
- Library of Congress surfaces featured posts prominently and uses curated entry points into collections.

## Recommended Delivery Phases

### Phase 1: Foundation

- add database tables
- add public updates routes
- add admin content area shell
- add homepage featured letter
- add homepage latest update module

### Phase 2: Admin authoring

- updates list view
- update editor
- draft/publish flow
- featured letter picker
- public header/footer nav changes

### Phase 3: structured page editing

- migrate About page to managed content
- migrate Contact page to managed content
- migrate Support page to managed content

### Phase 4: polish

- scheduling
- preview improvements
- revision history
- optional analytics/dashboard summaries

## Acceptance Criteria

The feature set should be considered complete when:

- admins can create and publish public updates without code changes
- the public can browse a clean updates index and detail page
- the homepage shows a featured letter and latest update
- About, Contact, and Support copy can be edited through admin
- design remains visually consistent with the current public site
- public update pages have solid metadata and internal linking

## Additional Implementation Notes

### Preserve aesthetic consistency

The current site uses a restrained editorial/archive design language.

The updates system should feel like part of the same world:

- elegant typography
- generous spacing
- card-based or section-based layout
- not a generic SaaS blog layout
- not overly technical or startup-styled

### Keep the archive central

The updates surface should always point people back into:

- letters
- collections
- contributors/support

It should not become a detached stream of product announcements.

## Suggested Build Summary

If implementation is delegated to another agent, the high-level ask is:

- add a new admin `Content` area
- create a public `Updates` publishing system
- create a featured-letter slot for the homepage
- make About, Contact, and Support admin-editable with structured fields
- keep the public archive experience primary
- preserve the site's current editorial design language

## Source Links

- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://developers.google.com/search/docs/appearance/title-link
- https://developers.google.com/search/docs/appearance/structured-data/article
- https://www.gov.uk/guidance/content-design/writing-for-gov-uk
- https://www.gov.uk/guidance/content-design/blogging
- https://pro.europeana.eu/page/creating-editorial
- https://pro.europeana.eu/files/Europeana_Professional/Projects/Project_list/DS4CHDeployment/CNECT_LUX_2021_OP_0070_DS_Users_and_usage_report_M06.pdf
- https://pro.europeana.eu/post/user-engagement-and-the-distribution-of-culture
- https://blogs.loc.gov/
- https://blogs.loc.gov/folklife/2023/07/a-new-look-for-the-afc-web-pages/
