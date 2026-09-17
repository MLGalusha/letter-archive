# Complete exact-search excerpts (#44)

Baseline: main `5a54cce0`. The current public preview already wraps and scrolls; the remaining reproduced truncation was in the API. A real 158-character exact transcript query returned one result but only 95 highlighted characters before the ellipsis. Neither Chromium nor WebKit could recover text absent from the response.

The ordinary excerpt window targets 108 characters with 18 characters before a match. An exact phrase longer than the remaining 90 characters can be cut. Expanding that existing window to a word boundary also returned all 6,000 characters in a fixture containing thirty adjacent copies of a 200-character phrase.

The change preserves one individual exact match before adjacent highlights merge. For matches longer than 90 characters, its window contains the complete original-text span plus at most 18 characters of context on either side. Partial context words are trimmed inward. Request validation limits the query to 200 characters; Unicode offsets still refer to the mapped original text, whose length can differ after database case folding. The window cannot expand to an entire repeated-match run. Ordinary and short exact window selection is unchanged.

## Verification

- Before the fix, all four initial regressions failed: long phrases at the beginning, middle, and end were clipped, and the repeated phrase returned 6,000 characters.
- After the fix: 58 real PostgreSQL route fixtures passed in the default libc configuration; 71 route/helper fixtures passed with PostgreSQL ICU. These include 91- and 108-character boundary cases, multiline text, İstanbul, an emoji, and a 200-character repeated phrase. Each run used its own disposable Docker database.
- Backend TypeScript validation passed.

- Chromium and WebKit replayed a captured response from the updated route against the disposable ICU database in the current local frontend. At both 320px and 390px widths, the highlighted DOM text equaled the entire 167-character multiline query, including İstanbul and the emoji. Both engines had equal preview scroll/client widths (no horizontal overflow) and could scroll to the final highlighted word.
- The browser fixture has one text-only archive card and stubs unrelated content endpoints. It proves response-to-preview rendering, not production network performance or physical touch behavior. WebKit used Playwright's iPhone 13 profile; Chromium used a narrow desktop viewport. Neither is physical iPhone Safari or Chrome.

Local evidence is preserved in the task worktree under `output/playwright/`: `excerpt-api-fixture.json`, both `check-*.js` replay scripts, both `*-result.txt` outputs, and screenshots at both widths. Test logs are preserved alongside them. No temporary fixture-export logging remains in the tests.

This change does not reposition previews near the viewport bottom or change native mobile long-press behavior. Physical iPhone 13 Safari and Chrome checks remain part of the public manual checklist.
