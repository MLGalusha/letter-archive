# Mobile transcript gutters (#22)

Main `5a54cce0` reading mode placed transcript text at x=17 through x=390 in a 390px viewport: 17px left clearance and no right clearance. The article's wide grid track reaches the viewport edges at small sizes, while `.letter-transcript-section` supplied only left padding. Original formatting already had 32px padding on both sides.

The fix gives reading mode 1.25rem inline padding through the existing 900px responsive breakpoint. The original-format rule and desktop layout are untouched. No transcript content, reflow algorithm, reader state, or image geometry changes.

## Rendered verification

Chromium and WebKit both measured the reading text at 21px left / 20px right at widths 320, 390, and 844px; the remaining 1px is the existing verification-status border. No text-container overflow was measured. Desktop at 1440px retained its existing 281px / 264px bounds. Original formatting at 390px retained 32px / 32px padding and no document overflow. The before/after screenshots were visually inspected.

On the local frontend with read-only public API responses, Home, Collections, Collection 003, About, Support, Journal, Jimmie's person page, and Overland Park's place page already had 16px / 16px wrapper padding at 390px and no horizontal document overflow after their layout/fonts settled. Initial sampling before settling briefly reported overflow; this audit does not claim to diagnose first-paint timing. No speculative padding overrides were added to those pages. This is representative route coverage, not an exhaustive check of every published document or viewport.

Local artifacts: `output/playwright/transcript-padding-after.png`; baseline screenshot in the public-followups checkout. Browser emulation does not establish physical iPhone behavior; the guide includes Safari/Chrome checks.

## Reader refactor separation

The existing local Reader View V2 README was read without changing the protected primary checkout. It explicitly separates segment trust/mapping from reader derivation and stages implementation. Its larger canonical-text/trusted-geometry scope is now preserved in issue #111, coordinated with #53 and unrelated open PR #61. This padding change does not implement or merge that pipeline work.

## Try after deployment

Open [the October 18 letter](https://voicesthatremain.com/letter/0b5e626d-01bb-4026-a4fa-a6ebdf180c7d#letter-transcript) in Safari and Chrome on the iPhone 13. In reading mode, both sides should have visible breathing room. Rotate the phone, switch to Original formatting, and switch back; text should remain reachable and no horizontal page movement should be necessary for reading mode. Original-format lines may use their own intended horizontal reading behavior.
