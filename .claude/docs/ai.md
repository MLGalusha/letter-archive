# AI Integration

OpenAI-powered transcription and metadata extraction for historical letters.

## Architecture

```
backend/src/ai/
├── openai.ts              # API client wrapper, transcription, extraction
├── prompts.ts             # System prompts, controlled vocabularies
├── resync.ts              # Metadata auditing and regeneration
└── schemas/
    ├── metadataV2.ts      # Zod schema for basic metadata (Prompt 1)
    └── entityExtraction.ts # Zod schema for entity extraction (Prompt 2)
```

## Models Used

| Task | Model | Notes |
|------|-------|-------|
| Transcription | GPT-5.2 | Vision model, base64 images |
| Metadata V1 | GPT-5.2 | JSON mode (legacy) |
| Metadata V2 (Prompt 1) | GPT-5.2 | Basic metadata - structured outputs |
| Entity Extraction (Prompt 2) | GPT-5.2 | Rich people/places - structured outputs |
| Resync audit | GPT-4o-mini | Fast, cheap decision model |
| Resync regen | GPT-5.2 | Quality regeneration |

## Transcription

Converts letter images to text using vision capabilities.

```typescript
import { transcribeImage } from './ai/openai.js';

const result = await transcribeImage({
  filePath: '/path/to/letter.jpg',
  context: {
    collectionCode: '009',
    dateRaw: '19470810',
    pageNumber: 1,
    totalPages: 2,
  },
});
// result.text - transcribed content
// result.isStub - true if using stub mode (no API key)
```

Key prompt features:
- Preserves line breaks exactly as written
- Preserves horizontal spacing (dates on right, centered text)
- Uses `[illegible]`, `[unclear: guess]` for uncertain text
- No headers or commentary in output

## Metadata Extraction

### V1 (Legacy)
Simple JSON mode extraction. Returns basic fields: sender, recipient, location, hook, summary, tags, date.

### V2 (Current)
Uses OpenAI Responses API with strict JSON schema enforcement.

```typescript
import { extractMetadataV2 } from './ai/openai.js';

const result = await extractMetadataV2({
  transcriptionText: '...',
  context: { collectionCode: '009' },
});
// result.metadata - validated MetadataV2 object
// result.isStub - true if stub mode
```

**V2 Schema fields (Prompt 1 - basic metadata):**
- `sender`, `recipient`, `location_written` - with confidence scores
- `extracted_date`, `extracted_date_confidence`
- `hook` (max 150 chars), `summary`
- `emotional_tone` - enum (joyful, hopeful, neutral, anxious, sad, angry, desperate)
- `sender_recipient_relationship` - enum (spouse, parent, friend, etc.)
- `primary_topics[]` - from fixed vocabulary
- `notable_quotes[]` - with position and context

## Entity Extraction (Prompt 2)

Runs after basic metadata extraction. Extracts rich profiles of people and places.

```typescript
import { extractEntities } from './ai/openai.js';

const result = await extractEntities({
  transcriptionText: '...',
  basicMetadata: { sender, recipient, senderRecipientRelationship, summary },
  context: { collectionCode: '009' },
});
// result.entities.people[] - rich person profiles with aliases, details, quotes
// result.entities.places[] - places with type, context, associated people
// result.entities.relationships[] - person-to-person relationships with evidence
// result.entities.person_place_connections[] - person-to-place connections
```

**Entity Schema fields:**
- `people[]` - name, aliases, role, details (freeform `{detail, category}`), emotional_significance, quotes, confidence
- `places[]` - name, type, role, why_mentioned, descriptive_details, associated_people, confidence
- `relationships[]` - person_a, person_b, relationship_type (bidirectional), evidence, confidence
- `person_place_connections[]` - person_name, place_name, connection_type, evidence

**Two-phase pipeline:** Phase 2 failure is non-fatal — basic metadata from Phase 1 is always preserved. Entity extraction can be re-run independently via `POST /admin/letters/:id/regenerate-entities`.

## Controlled Vocabularies

Following OpenAI Cookbook's temporal agent pattern, enums include definitions and indicators:

```typescript
// In prompts.ts
const RELATIONSHIP_DEFINITIONS = {
  'spouse': {
    definition: 'Married couple - husband and wife',
    indicators: ['my dear wife', 'your loving husband', 'Mrs.']
  },
  'romantic-partner': {
    definition: 'Romantic relationship, not engaged or married',
    indicators: ['sweetheart', 'darling', 'my love', 'courting']
  },
  // ...
};
```

The prompt includes:
- Explicit allowed values
- Definitions for each value
- Example indicators to look for
- "COMMON MISTAKES TO AVOID" section

## Resync Feature

Two-model approach for metadata consistency:

### 1. Audit (GPT-4o-mini)
Fast check for issues:
- Summary/hook using generic terms instead of names
- Missing linked persons for sender/recipient
- Missing relationship type

```typescript
import { auditMetadata } from './ai/resync.js';

const decision = await auditMetadata({
  sender: 'Jimmie',
  recipient: 'Molly',
  summary: 'The sender writes to the recipient...',
  linkedPersons: [],
  // ...
});
// decision.shouldUpdateSummary = true
// decision.shouldCreateSenderPerson = true
// decision.issues = ['Summary uses generic terms...']
```

### 2. Regenerate (GPT-5.2)
Fixes identified issues with quality output:

```typescript
import { regenerateMetadata } from './ai/resync.js';

const result = await regenerateMetadata({
  transcript: '...',
  sender: 'Jimmie',
  recipient: 'Molly',
  decision: auditDecision,
  currentSummary: '...',
  currentHook: '...',
});
// result.summary - updated text with actual names
// result.senderPerson - { name: 'Jimmie', role: 'sender' }
```

### Combined Flow

```typescript
import { resyncMetadata } from './ai/resync.js';

const result = await resyncMetadata({
  transcript,
  context: { sender, recipient, summary, hook, linkedPersons, ... },
});
// result.wasUpdated
// result.decision - what was checked
// result.summary, result.senderPerson, etc. - updated fields
```

## Stub Mode

When `OPENAI_API_KEY` is not set, all functions return stub data for development:

- `transcribeImage` returns placeholder text
- `extractMetadata` returns basic stub metadata
- Stub responses include `[STUB]` markers

Check `result.isStub` to detect stub mode.

## Error Handling

All AI functions:
- Log timing and usage to `backend/logs/app.log`
- Throw on API errors (caller handles)
- Include request context in logs for debugging

## Files

| File | Purpose |
|------|---------|
| [openai.ts](../../backend/src/ai/openai.ts) | API client, transcription, extraction functions |
| [prompts.ts](../../backend/src/ai/prompts.ts) | System prompts, controlled vocabulary definitions |
| [resync.ts](../../backend/src/ai/resync.ts) | Two-model audit + regeneration |
| [schemas/metadataV2.ts](../../backend/src/ai/schemas/metadataV2.ts) | Zod + JSON schema for basic metadata (Prompt 1) |
| [schemas/entityExtraction.ts](../../backend/src/ai/schemas/entityExtraction.ts) | Zod + JSON schema for entity extraction (Prompt 2) |
