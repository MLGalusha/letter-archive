# Admin Redesign Design Space

This folder tracks the admin frontend redesign while it is in progress. It is a working design space, not final product documentation.

## Purpose

- Keep design decisions, tradeoffs, and roadmap state visible across sessions.
- Separate product/UI decisions from implementation details.
- Give future agents a single place to recover the current direction before editing code.

## Current Focus

The first redesign target is the admin dashboard at `/admin`.

The implementation should improve code structure first, then visual polish. The first pass should keep the existing backend/API behavior intact unless a separate decision says otherwise.

## Files

- `roadmap.md` - current phases, active scope, and what is intentionally out of scope.
- `decisions.md` - accepted decisions and unresolved questions.
- `dashboard-design.md` - working design notes for the admin dashboard.

## Working Rule

When a meaningful product, layout, or architecture decision is made during the redesign, update `decisions.md`. When the active phase changes, update `roadmap.md`.
