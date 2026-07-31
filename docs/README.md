# Documentation Index

## Start Here

| Doc | Purpose |
|-----|---------|
| [about-this-project.md](about-this-project.md) | Project vision, "wise guide" AI concept |
| [collaboration-style.md](collaboration-style.md) | Proactive questioning, planning before implementing |
| [architecture-cleanup/](architecture-cleanup/) | Active cleanup loop, baseline, and resumable checkpoint |

## Technical Reference

| Doc | Purpose |
|-----|---------|
| [components.md](components.md) | UI components (Button, Modal, Badge, etc.) |
| [api/](api/) | API endpoints split by domain |
| [database.md](database.md) | Schema, tables, enums |
| [processing.md](processing.md) | Transcription and metadata pipeline |
| [filenames.md](filenames.md) | Filename parsing conventions |
| [sync.md](sync.md) | Frontend/backend value sync |

## Future Research and Design Ideas

| Doc | Purpose |
|-----|---------|
| [design/archive-htr-and-contextual-transcription-future-ideas.md](design/archive-htr-and-contextual-transcription-future-ideas.md) | Archive-specific HTR, contextual LLM crops, image enhancement, training-data flywheel, and evaluation roadmap |

## Keeping Docs Updated

When modifying documented code, update the relevant doc. Keep docs concise—Claude already knows general patterns.

## Creating New Docs

1. Create `docs/{feature-name}.md` or a focused folder under `docs/`
2. Add to this README
3. Link it from the closest architecture or feature index
