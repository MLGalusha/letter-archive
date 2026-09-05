# Site improvements — September 2026

## Scope

Work begins from origin/main at 11280b24 in an isolated checkout. The original
rotated-region-recovery checkout and uncommitted handwriting work are excluded.
The research-only placement fixture, native Python test, and lab transport findings
from the audit are not present on this baseline and will not be imported.

## Delivery policy

One focused PR per fix. Required CI checks must pass before merge. Inspect review
comments and resulting production release; measure affected behavior. Never force
merge or weaken a test to hide a failure. Record deferred product decisions.

## Work

| Fix | Verification | Delivery |
| --- | --- | --- |
| Protect pending review autosaves on navigation and document exit | Browser checks cover saved notes and failed-save retention; hook checks cover waiting and exit warning; production build passes | PR pending |

## Next

Fatal API lifecycle; shared public ordering/date ranges; bounded data and image
loading; navigation cache recovery; truthful settings/link semantics/loading UX;
public initial metadata; dependency and CI hygiene. Product-specific content and
unavailable donation/contact setup remain deferred.
