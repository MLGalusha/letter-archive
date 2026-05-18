# Admin Redesign Idea Log

This log captures ideas that come up during implementation. Entries may be in-scope, adjacent, or explicitly out-of-scope. Logging an idea does not mean it was implemented.

Each entry should include:

- Idea
- Why it is relevant
- What triggered it
- Scope recommendation

## Ideas

### Mobile Bulk Actions As Primary Row Plus Action Managers

Idea:

- On mobile, treat bulk actions as a compact selection mode surface with a persistent primary row for count, page/all selection, and close/save, plus secondary action groups opened through manager buttons such as Edit, Process, Publish, and Danger.

Why it is relevant:

- The current mobile bulk toolbar stacks to roughly a quarter of the viewport after selecting a single row and still allows horizontal overflow in the right-side action group.
- Selection is a mode, and mobile users need the selected count and exit/save controls more than they need every destructive or processing action visible at once.

What triggered it:

- Playwright measurement at 390x844 showed `.edit-toolbar-content` around 206px tall, with the Publish/Danger row extending beyond the viewport width.
- The dashboard manager shell work already created a usable pattern for high-touch grouped actions such as Publishing.

Scope recommendation:

- In scope for the selection/bulk redesign if we decide mobile should prioritize a compact mode bar.
- Do not implement automatically until the selection model is documented, because it changes visible workflow hierarchy.
