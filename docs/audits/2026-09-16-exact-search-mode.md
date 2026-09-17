# Optional exact phrase mode (#47)

An unchecked-by-default **Exact phrase** checkbox appears in archive refine controls. It narrows typed search within the permitted fields from #87. Ordinary matching from #88 remains the default.

Exact mode trims leading/trailing query whitespace and ignores case. All remaining characters must occur contiguously in one source, in order: punctuation and internal spaces are literal. It allows substrings rather than imposing word boundaries, so `he` can still match `the`. It bypasses approximate names/places entirely. Generated page separators remain excluded in both modes.

Examples: exact `red lantern` matches that phrase but not `lantern glowing red`; `red  lantern` requires the two spaces; `Mollly` does not match `Molly`; `%` requires a percent character. Highlights cover the matching phrase, not independently matching words. Field fallback stays transcript first, then date/sender/recipient/location, and publication gates stay intact.

The `exact=true` URL/API parameter follows the existing search codec, persistence and request path. Reloads and shared URLs reproduce the mode; pagination carries it forward. Back navigation restores the mode of the target URL. Clearing only the query retains filter choices and mode; clearing all resets them. Switching off omits the parameter and restores ordinary matching without losing filters.

Verification includes real disposable PostgreSQL fixtures for exact phrase, literal punctuation/whitespace, absence of fuzzy admission, publication/field exclusions, and pagination/filter/sort combinations. Frontend coverage checks URL/state round trips, persistence/reload/Back, and keyboard operation without losing another filter. The existing result/preview API shape is unchanged.

Browser checks used the local frontend with explicitly mocked empty catalogue responses, alongside separate real-SQL route tests. At 390px and 1440px, the checkbox, URL update, emitted API parameter, mode restoration after reload, and removal on switch-off worked without document overflow. Screenshots and capture are local under `output/playwright/exact47-*`. Auxiliary home content was deliberately unavailable in this fixture; these checks do not establish production search results or live performance.

No new state store, query parser, search service, or database migration is introduced. The control uses the existing refine panel so the mobile query row does not gain another crowded button.

The final feature patch is based on the reviewed ordinary-search implementation, including database-owned casing and fuzzy word boundaries. Exact mode never requests fuzzy token metadata. ICU/libc fixtures retain each provider's casing policy, verify exact stays literal when ordinary metadata matches fuzzily, and preserve the Date-source correction. The exact-only, empty-query Clear All case is covered so the remaining mode can always be reset.

Final integration also retains the year-entry, accessible-preview, facet-identity, request-cancellation, and row-snapshot fixes. Exact out-of-range pages are tested with both short and longer input: they retain the total, omit the SQL placeholder from results, and do not attempt to build preview maps for it. A no-match exact query returns zero and an empty array.
