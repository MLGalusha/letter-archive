# Claude Agent Documentation Index

This folder contains documentation for Claude agents to quickly understand the Letter Archive codebase.

## Available Documentation

| Document | Description |
|----------|-------------|
| [reusable-components.md](reusable-components.md) | Common UI components (Button, Modal, Badge, Dropdown, etc.) |
| [frontend-architecture.md](frontend-architecture.md) | Page structure, routing, component hierarchy, API connections |
| [api-contracts.md](api-contracts.md) | All API endpoints with request/response shapes |
| [filename-conventions.md](filename-conventions.md) | File naming rules for letter images |
| [processing-pipeline.md](processing-pipeline.md) | AI transcription and metadata extraction workflow |
| [database-schema.md](database-schema.md) | PostgreSQL tables, relations, and constraints |

## How to Use These Docs

1. **Before exploring**: Read the relevant doc for your task
2. **After modifying**: Update the doc if you changed documented code
3. **New features**: Create a new doc if the feature is complex enough

## Creating New Documentation

### When to Create a New Doc

- Feature has multiple files or complex logic
- Pattern is used in multiple places
- Future maintainers would benefit from context
- You found yourself needing to explain it

### Naming Convention

Use kebab-case: `{feature-name}.md`

Examples:
- `logging.md`
- `error-handling.md`
- `upload-workflow.md`

### Template

```markdown
# {Feature Name}

## Overview
Brief description of what this feature does.

## Location
Key files:
- `path/to/main/file.ts`
- `path/to/related/file.ts`

## How It Works
Explanation of the pattern/architecture.

## Usage Examples
Code snippets or scenarios.

## Related Docs
- [related-doc.md](related-doc.md)
```

### After Creating

1. Add to the table above
2. Add to the table in `/CLAUDE.md`
3. Add self-updating rule to `/CLAUDE.md` if applicable

## Keeping Docs Updated

The root `/CLAUDE.md` contains a self-updating directive. When you modify code covered by a doc, update that doc at the end of your changes. This is critical for keeping documentation useful.
