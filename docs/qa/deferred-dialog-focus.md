# Deferred dialog focus

Issue #163 follows release checks for #161. The admin analysis regeneration
test lost focus on its first attempt in CI runs 35300308435 and 35302281160;
retries passed. The first-attempt trace was not retained, so its precise event
ordering is unconfirmed.

A deterministic regression test demonstrates a timing hole in the shared helper:
close the dialog while its opener is disabled, request focus restoration, allow
the microtask and animation frame to finish, then enable the opener in a later
React commit. The previous implementation leaves focus on the document body.

Restoration now remains pending until a React commit makes the opener available.
An explicit request schedules a commit even when the opener is already enabled.
Moving focus to another control or opening another modal cancels the pending
return. No timer remains after unmount. Normal fullscreen dismissal is unchanged.

This uses the existing React lifecycle rather than a longer timeout. React's
[useEffect documentation](https://react.dev/reference/react/useEffect) describes
effects after commits and the every-commit behavior when dependencies are omitted.
No dependency upgrade or visual change is involved.

Validation covers late re-enabling, user-selected focus, a competing modal,
unmount, existing admin regeneration flows, and fullscreen keyboard interactions
in Chromium and WebKit. The deterministic test failed against the previous
helper and passes with this change. CI outcomes remain separate evidence from
the proposed explanation for the intermittent remote failure.
