# Letter Archive

A platform for preserving and exploring historical letter collections. Transforms physical letters into a searchable digital archive where visitors can discover stories, follow relationships, and explore personal history.

## The Vision

The goal is an AI-powered experience that feels like talking to **someone who has read every letter**:

> "What letters do you have from the Civil War?"
> "Tell me about someone who experienced loss."
> "What was happening in 1942?"

Not database queries—thoughtful answers from a guide who knows all the stories.

## Features

### Public Archive
- Browse and search digitized letter collections
- View high-quality scans with zoom and pan
- Read AI-generated transcriptions (human-verified)
- Filter by date, location, sender, recipient, or theme
- Explore connections between people and places across letters

### Admin Dashboard
- Upload and organize letter images by collection
- AI-powered transcription with GPT-5.2
- Structured metadata extraction (dates, people, places, topics)
- Two-track verification: transcription review + metadata confirmation
- Entity management: merge duplicate people/places, track relationships
- Resync feature: automatically update derived fields when identities change

### AI Pipeline
- **Transcription**: OCR-quality text from handwritten letters
- **Metadata Extraction**: Structured data with confidence scores
- **Controlled Vocabularies**: Consistent categorization (relationship types, emotional tones, topics)
- **Resync**: Two-model approach for metadata consistency auditing and regeneration

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, TypeScript, Vite, React Router |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL with Drizzle ORM |
| AI | OpenAI GPT-5.2 (structured outputs) |
| Storage | Local filesystem (GCP planned) |

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- OpenAI API key

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/letter-archive.git
cd letter-archive

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Set up environment
cp backend/.env.example backend/.env
# Edit .env with your database URL and OpenAI key

# Run database migrations
cd backend && npm run db:push

# Start development servers
cd backend && npm run dev     # API on localhost:3000
cd frontend && npm run dev    # UI on localhost:5173
```

## Project Structure

```
letter-archive/
├── frontend/src/
│   ├── components/common/   # Reusable UI components
│   ├── pages/               # Route pages (public + admin)
│   ├── api/                 # API client functions
│   └── types/               # TypeScript interfaces
│
├── backend/src/
│   ├── routes/              # Express route handlers
│   ├── services/            # Business logic
│   ├── db/                  # Drizzle schema + migrations
│   ├── ai/                  # OpenAI integration + prompts
│   └── pipeline/            # Processing workflows
│
└── .claude/docs/            # Architecture documentation
```

## Documentation

See [.claude/docs/](.claude/docs/) for detailed documentation:
- [API Reference](.claude/docs/api/) - Endpoint documentation
- [Database Schema](.claude/docs/database.md) - Table structures
- [Processing Pipeline](.claude/docs/processing.md) - AI workflow
- [Components](.claude/docs/components.md) - UI component library

## Roadmap

- [ ] Public browsing interface
- [ ] Semantic search with vector embeddings
- [ ] AI guide chat interface
- [ ] Collection sharing and permissions
- [ ] GCP deployment with Cloud Storage

## License

MIT
