# Site improvement report

Implementation and measurement record for the September 4–5, 2026 improvement series. The final delivery gate is [PR 76](https://github.com/MLGalusha/letter-archive/pull/76); its linked main workflow records the final release result.

## Scope and preservation

Work is isolated in `letter-archive-site-improvements`. The original dirty handwriting/research checkout was not edited or included in these changes. No production processing runs, uploads, or editorial edits were manually triggered for validation. Deployment remained with the existing release pipeline.

## Changes

| PR | Change |
| --- | --- |
| [62](https://github.com/MLGalusha/letter-archive/pull/62) | Protect unsaved review edits when navigating away |
| [63](https://github.com/MLGalusha/letter-archive/pull/63) | Terminate backend processes after fatal errors |
| [64](https://github.com/MLGalusha/letter-archive/pull/64) | Keep public catalogue navigation in a consistent order |
| [65](https://github.com/MLGalusha/letter-archive/pull/65) | Limit public image preloading to nearby content |
| [66](https://github.com/MLGalusha/letter-archive/pull/66) | Cache and bound CI browser installation |
| [67](https://github.com/MLGalusha/letter-archive/pull/67) | Preserve partial dates in collection ranges |
| [68](https://github.com/MLGalusha/letter-archive/pull/68) | Recover public navigation after catalogue request failures |
| [69](https://github.com/MLGalusha/letter-archive/pull/69) | Simplify public health diagnostics |
| [70](https://github.com/MLGalusha/letter-archive/pull/70) | Paginate catalogue units before loading public content |
| [71](https://github.com/MLGalusha/letter-archive/pull/71) | Connect admin settings to public branding and metadata |
| [72](https://github.com/MLGalusha/letter-archive/pull/72) | Use native links for archive, featured, and highlight cards |
| [73](https://github.com/MLGalusha/letter-archive/pull/73) | Clarify public loading and reader navigation |
| [74](https://github.com/MLGalusha/letter-archive/pull/74) | Update audited dependencies and gate production advisories |
| [75](https://github.com/MLGalusha/letter-archive/pull/75) | Load lightweight public collection overviews |
| [76](https://github.com/MLGalusha/letter-archive/pull/76) | Gate lint regressions and make CI diagnostics resilient |
| [77](https://github.com/MLGalusha/letter-archive/pull/77) | Render the homepage feature without unrelated request delays |
| [78](https://github.com/MLGalusha/letter-archive/pull/78) | Defer offscreen catalogue images and inactive showcase scans |

## Measurements and interpretation

- Verified against production after the overview release, collection 009 JSON: 57,027 to 14,987 bytes; gzip 10,936 to 3,655 bytes (about 67% smaller), same 24 catalogue items. This compares the same public dataset and excludes transport timing.
- Initial background preload scheduling: collection 009 92 to 6 images; synthetic 1,000-item/four-page collection 5,000 to 6. These are scheduler measurements, not whole-page network counts.
- Production browser measurement after the scheduler change alone still averaged about 94 image requests. No overall LCP improvement was established.
- After fixing hidden showcase scans and actual lazy loading, all three production mobile trials initiated 37 image requests, versus 91–98 before (about 61% fewer). Three further production trials after the overview release also each initiated 37. Additional images load on scroll. LCP remains variable: 1.3–4.9 seconds in the latest three trials, versus 2.1–4.6 seconds before; this does not establish a consistent LCP improvement.
- Public catalogue pagination selects/counts keys before hydrating only the requested page. Local 95-unit dataset returned 20 units on each of pages 1 and 2 with no overlap; an empty far page retained the correct total. In the latest local run, warmed page queries took about 5–7 ms; the first query including connection startup took about 180 ms. These are local observations, not a production latency comparison.
- Dependency audit: frontend full tree 8 affected packages to 0; backend production audit 0; backend full tree 9 to 4 moderate development-only findings in the Drizzle/esbuild toolchain. Avoided forced incompatible upgrades/downgrades.

## What changed in practice

### Admin and configuration

- Review navigation now waits for queued autosaves. Failed saves retain the editor and provide an explicit discard path; closing or refreshing the document warns about pending changes. Visit/revision fencing remains in place.
- Site settings use one canonical representation while preserving compatibility with older admin bundles. Section saves update only that section, and writes synchronize legacy aliases atomically. Public responses remain allowlisted.
- Saved branding flows through the header, footer, rendered titles/default descriptions, and site-owned structured metadata. Authored historical descriptions and person names remain intact. Mounted consumers receive later successful retries and invalidations.
- No branding migration was added: the separate handwriting branch already owns the next migration numbers. Old seed defaults are handled on reads and compatible writes without changing migration history.

### Public browsing and performance

- Catalogue ordering is shared across browsing, summaries, collection navigation, and adjacent links. Partial dates retain their known precision, including lowercase unknown markers and partially known years.
- SQL selects/counts catalogue identities before hydrating the requested page, instead of loading full matching content before slicing. The total still requires scanning/counting matching identities; this is not a constant-time query claim.
- Collection overview responses omit transcripts, long summaries, notes, and large JSON fields. They still contain a lightweight entry for each item; total response size is still proportional to collection size. Further server-side aggregates and a bounded highlight projection remain a possible scale improvement.
- Background image work is capped to nearby items, obsolete work is cancelled, metadata caches are bounded, and failed images can retry. Lazy image hooks now respect visibility; inactive showcase scans are unmounted. Each homepage featured card mounts at most the current/previous/next scan and starts its feature independently of secondary content requests.
- Archive cards, collection highlights, and the homepage featured card become ordinary links with keyboard/new-tab behavior. Admin selection cards remain buttons. Carousel drag suppression and sibling page controls retain their distinct behavior.
- Navigation request cleanup no longer produces an orphan rejected promise. Adjacent navigation works when the full shelf fails, and cached collections expire and recover.
- Loading counts no longer flash false zeroes; catalogue vocabulary reflects photo-only items. Reader shortcuts reach scans/transcripts sooner, and unfinished support channels say so before a click.

### Backend and delivery

- Fatal process errors log once and terminate with a nonzero exit so the supervisor can replace the process. Ordinary request error handling remains separate.
- Public health responses expose minimal status. Raw readiness errors stay in structured logs; the unused detailed debug endpoint and request counters are removed.
- Compatible dependency updates remove the identified frontend findings and unused backend image-size dependency. Production advisory checks run in CI; no forced incompatible Drizzle change was applied.
- CI cancels superseded PR runs, caches the pinned headless Chromium download, and bounds browser installation. A reviewed lint budget rejects increases and fatal parsing errors; existing debt remains visible.
- Diagnostic report uploads have a two-minute bound and explicit warnings. Artifact-service failures do not turn successful tests into failed quality results. Actual test/build/typecheck/lint/audit failures still block delivery.

## Verification method

Each focused PR runs the required quality, mocked-browser, and database-backed smoke checks against its current base. Review findings were evaluated, fixed where applicable, and resolved before merge. Main runs repeat those checks and release the exact merged revision; releases are serialized and checked through public frontend/backend version endpoints and backend readiness.

CI on the final native-link revision passed 1,229 backend tests and 1,138 frontend tests. Combined local validation passed all 83 mocked browser checks, the three Node lint-policy tests, and the 103-diagnostic gate with no increases. Validation also includes production builds, TypeScript checks, focused real-browser regressions, fatal-process subprocess tests, and read-only PostgreSQL pagination checks. The native SQL check used 95 catalogue units: two non-overlapping 20-item pages and an empty far page with the correct total. No application rows were written for these measurements.

Browser measurements use headless Chromium at 390 × 844, a fresh context for each of three trials, direct navigation to `/collections/009`, and five seconds after the collection heading appears. Counted image requests are distinct URLs initiated during that window. Response byte totals based on Content-Length are approximate and are not used to claim total wire savings. Browser timings are observations from a small sample, not real-user monitoring or a controlled production latency experiment.

## Limits and follow-up

- Original handwriting placements, native Python research prerequisites, and experimental transport clients were excluded as requested.
- Public HTML is still a client-rendered shell. Route-specific initial social/search metadata needs a dedicated rendering and publication-invalidation design; this series does not claim to solve it.
- Editorial collection descriptions, donation activation, and contact destinations require owner decisions. No generated historical claims or payment destinations were published.
- Existing lint debt is tracked by a ratchet, not declared clean. No manual iOS device certification, load/stress test, or exhaustive line-by-line review is claimed.
- Large admin editor chunks remain route-lazy and are not all loaded on public pages. No framework migration, microservices, or speculative abstraction layer was introduced.

## Issues caught during delivery

- The first release was rejected by the existing stale-revision guard after the next fix advanced main too early. It made no production change and was safely superseded by the subsequent green release containing both fixes. Later releases were serialized through completion.
- One release passed its browser tests but hit a GitHub artifact-service timeout. Rerunning that failed job succeeded; the final CI change now bounds diagnostic uploads and warns on their failure while keeping actual checks mandatory.
- Combined validation caught the Node lint-policy test file being discovered by Vitest. It now has an explicit Node-only filename and still runs in the mandatory lint command. The complete combined suites then passed.
- Review feedback led to concrete additional fixes for partial-date precision, mounted cache expiry/retry, legacy settings compatibility, nested image scroll boundaries, and carousel gesture cleanup. Resolved threads retain those discussions and validation evidence.

## Release verification

The PR links retain commits, required-check results, review discussions, and associated main release workflows. PR 76 is the final CI/reporting change; its main run is the final release gate. Different frontend/backend revisions can be valid after a frontend-only release.

Live verification during the series confirmed the smaller overview with identical item IDs, the homepage preview and API connection hint, healthy version/readiness endpoints, and both mobile scan/transcript shortcuts transferring focus to visible content. The support availability notice is visible before interaction. Final deployment confirmation is attached to PR 76 after its main release completes.

Measurement data: [public performance samples](public-performance-evidence.json), [dependency counts](dependency-evidence.json), [overview projection](collection-overview-measurements.json), and [preload scheduling](preload-measurements.json).
