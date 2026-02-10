# Plan Registry

## Active Plans

| Plan | State | Description |
|------|-------|-------------|
| [resizable-split-panel](resizable-split-panel.md) | IMPLEMENTING | Draggable divider + smart auto-scroll + line highlighting |
| [transcription-ui-refactor](transcription-ui-refactor.md) | IMPLEMENTING | Simplify transcription header and move verification to top-right |

---

## MANDATORY: How Plans Work

**YOU MUST FOLLOW THIS PROCESS. NO EXCEPTIONS.**

### States

| State | Meaning |
|-------|---------|
| `DRAFTING` | Someone is writing this plan. DO NOT TOUCH. |
| `READY` | Plan is complete. Wait for human to assign it to you. |
| `IMPLEMENTING` | Someone is executing this plan. DO NOT TOUCH. |

### When You Create a Plan

You MUST do ALL of these steps:

1. **Create the plan file:** `.claude/plans/<descriptive-slug>.md`
   ```markdown
   # Plan: <Title>

   **Status:** DRAFTING
   **Created:** <YYYY-MM-DD>
   **Description:** <one-line summary>

   ---

   <your plan content>
   ```

2. **Add to this registry:** Add a row to the Active Plans table above:
   ```
   | [plan-name](plan-name.md) | DRAFTING | One-line description |
   ```

3. **When plan is complete:** Update status to `READY` in BOTH the plan file AND this registry.

### When You Implement a Plan

1. Human tells you which plan to work on
2. Update status to `IMPLEMENTING` in BOTH the plan file AND this registry
3. Execute the plan
4. When done:
   - Move plan file to `completed/` folder
   - Remove row from Active Plans table

### Resuming Work

If human says "continue the plan" or "pick up where you left off":
1. Read the plan file
2. Continue from current state

---

## Completed Plans

Archived in `completed/` folder.
