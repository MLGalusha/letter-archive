# Interruptible public return scrolling

Issue #38. The document owns vertical scrolling. Search, the home archive link,
and Top share one animation lifecycle and an unmount-aware hook; components only
choose destinations and focus policy. Button appearance and placement stay the same.

The audit observed search focus at 176ms while scrolling continued to 684ms. Wheel
input at 208ms was overwritten by subsequent animation frames. These are lifecycle
conflicts, not evidence of a slow rendering bottleneck. Seven new helper regressions
failed before the correction. The old fixed-container explanation no longer matches
the current document-scroll architecture.

## Behavior

- A newer jump cancels the previous one. Wheel, touch, pointer input, scrolling keys,
  Tab, Escape and page exit cancel without consuming the user's input.
- A route change cancels before history restoration. Caller unmount cancels only its
  own action. Completion runs exactly once; late cancellation is harmless.
- Search focuses on successful arrival with preventScroll on desktop. Interrupted
  actions never steal focus. Touch retains the no-automatic-keyboard policy.
- Reduced motion jumps immediately. Targets clamp to the document's scroll range.
- Top clears suppression on completion or interruption, accumulates slow upward
  movement, and removes its hidden button from the tab order.
- Existing easing/duration remain. No new animation framework or independent timer.

## Verification

Focused unit checks cover cancellation, supersession, completion, reduced motion,
focus timing/unmount and slow direction changes. Browser checks cover real document
scrolling, delayed-focus arrival, interruption lasting beyond the old duration,
programmatic SPA navigation (without a pointer event), completed touch activation,
and preserved typing position across Chromium desktop/phone and WebKit phone.
Synthetic input and phone-sized browsers do not certify physical touch feel.

## Primary references

Checked September 18, 2026:
[MDN cancelAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/cancelAnimationFrame)
documents canceling the latest scheduled frame;
[MDN focus](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus)
documents preventScroll;
[MDN reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
documents the user's motion preference. The interruption/focus policy is the
project's interaction decision, not a claim that MDN prescribes this animation.

Physical iPhone Safari, installed Home Screen/PWA, and Chrome remain separate
acceptance checks. #158's reader return-control placement is a separate UI choice.
