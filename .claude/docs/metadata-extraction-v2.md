# Metadata Extraction V2: Design Document

## Overview

A comprehensive redesign of the metadata extraction system to enable:
1. **Rich structured metadata** for faceted search
2. **Entity registry** (people, places, events) for cross-letter connections
3. **Human-in-the-loop disambiguation** for accurate linking
4. **Natural language search** via AI query translation
5. **Future-ready** for vector embeddings

---

## Current State

### What We Extract Now
```typescript
{
  sender: string | null,
  recipient: string | null,
  location_written: string | null,
  hook: string | null,           // 1-2 sentence teaser
  summary: string | null,        // proportional summary
  tags: string[],                // freeform topic tags
  extracted_date: string | null,
  extracted_date_confidence: 'exact' | 'inferred' | null
}
```

### Limitations
- **No entity tracking**: Can't answer "show me all letters mentioning John"
- **Freeform tags**: Inconsistent, not searchable as facets
- **No emotional context**: Can't search by tone or mood
- **No relationship data**: Don't know who's related to whom
- **No place tracking**: Can't find "letters mentioning Manchester"

---

## New Metadata Schema

### Phase 1: Enhanced Letter Metadata

**New fields on `letters` table:**

```typescript
// Emotional & Contextual
emotionalTone: 'joyful' | 'hopeful' | 'neutral' | 'anxious' | 'sad' | 'angry' | 'desperate' | null,
formalityLevel: 'formal' | 'casual' | 'intimate' | null,
letterPurpose: 'personal' | 'business' | 'request' | 'announcement' | 'condolence' | 'gratitude' | null,

// Structured Topics (controlled vocabulary)
primaryTopics: string[],    // From controlled list (see below)
secondaryTopics: string[],  // Additional context

// Relationship Context
senderRecipientRelationship: string | null,  // "spouse", "parent-child", "siblings", "friends", etc.

// Historical Context
historicalEvents: string[], // Named events referenced (e.g., "World War II", "Gold Rush")
timePeriodContext: string | null, // "wartime", "peacetime", "depression era", etc.
```

### Controlled Vocabulary: Primary Topics

```typescript
const PRIMARY_TOPICS = [
  // Family & Relationships
  'family/marriage',
  'family/children',
  'family/death-grief',
  'family/separation',
  'family/reunion',

  // Life Events
  'health/illness',
  'health/recovery',
  'health/pregnancy-birth',

  // Work & Money
  'work/employment',
  'work/job-loss',
  'finances/hardship',
  'finances/prosperity',

  // Movement & Place
  'travel/journey',
  'travel/immigration',
  'home/moving',
  'home/property',

  // Communication
  'correspondence/news-sharing',
  'correspondence/advice',
  'correspondence/gratitude',
  'correspondence/apology',

  // Society & Events
  'war/service',
  'war/homefront',
  'religion/faith',
  'community/local-events',

  // Daily Life
  'daily-life/weather',
  'daily-life/farming',
  'daily-life/household',
  'daily-life/social',
] as const;
```

---

## Phase 2: Entity Registry

### New Tables

```sql
-- Canonical people registry
CREATE TABLE people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,           -- "John Smith"
  aliases TEXT[] DEFAULT '{}',            -- ["John", "Johnny", "J. Smith"]
  birth_year INTEGER,
  death_year INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link letters to people mentioned
CREATE TABLE letter_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id UUID REFERENCES letters(id) ON DELETE CASCADE,
  person_id UUID REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                     -- 'sender', 'recipient', 'mentioned'
  relationship_to_sender TEXT,            -- 'spouse', 'child', 'friend', etc.
  context TEXT,                           -- "Molly's daughter Barbara"
  confidence REAL DEFAULT 1.0,            -- AI confidence (0-1)
  confirmed_by TEXT,                      -- Admin who confirmed
  confirmed_at TIMESTAMPTZ,
  UNIQUE(letter_id, person_id, role)
);

-- Canonical places registry
CREATE TABLE places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,           -- "Manchester, England"
  aliases TEXT[] DEFAULT '{}',            -- ["Manchester", "MCR"]
  place_type TEXT,                        -- 'city', 'region', 'country', 'landmark'
  parent_place_id UUID REFERENCES places(id), -- Hierarchy
  latitude REAL,
  longitude REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link letters to places mentioned
CREATE TABLE letter_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id UUID REFERENCES letters(id) ON DELETE CASCADE,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                     -- 'written_from', 'mentioned', 'destination'
  context TEXT,                           -- "where they walked together"
  confidence REAL DEFAULT 1.0,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  UNIQUE(letter_id, place_id, role)
);

-- Historical events registry
CREATE TABLE historical_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                     -- "World War II"
  aliases TEXT[] DEFAULT '{}',            -- ["WWII", "The War", "Second World War"]
  start_year INTEGER,
  end_year INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link letters to events
CREATE TABLE letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id UUID REFERENCES letters(id) ON DELETE CASCADE,
  event_id UUID REFERENCES historical_events(id) ON DELETE CASCADE,
  context TEXT,
  confidence REAL DEFAULT 1.0,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  UNIQUE(letter_id, event_id)
);

-- Pending entity matches (for admin review)
CREATE TABLE entity_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,              -- 'person', 'place', 'event'
  extracted_text TEXT NOT NULL,           -- Raw text from letter
  letter_id UUID REFERENCES letters(id),
  suggested_entity_id UUID,               -- Existing entity AI thinks matches
  context TEXT,                           -- Surrounding text for context
  confidence REAL,
  status TEXT DEFAULT 'pending',          -- 'pending', 'confirmed', 'rejected', 'new_entity'
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Phase 3: New Extraction Prompt

```typescript
export const METADATA_V2_SYSTEM_PROMPT = `You are an expert archivist extracting structured metadata from historical letter transcriptions.

EXTRACTION GUIDELINES:
- Extract ONLY information explicitly stated or clearly implied
- Use null for uncertain fields
- Provide confidence scores (0.0-1.0) for entity matches
- For people, note relationship context when mentioned

OUTPUT FORMAT:
{
  // Core identifiers (as before)
  "sender": { "name": string | null, "confidence": number },
  "recipient": { "name": string | null, "confidence": number },
  "location_written": { "name": string | null, "confidence": number },

  // Date extraction
  "extracted_date": string | null,
  "extracted_date_confidence": "exact" | "inferred" | null,

  // Content teasers
  "hook": string | null,  // 1-2 sentences, max 150 chars, present tense
  "summary": string | null,  // Proportional to letter length

  // Emotional & Contextual
  "emotional_tone": "joyful" | "hopeful" | "neutral" | "anxious" | "sad" | "angry" | "desperate" | null,
  "formality_level": "formal" | "casual" | "intimate" | null,
  "letter_purpose": "personal" | "business" | "request" | "announcement" | "condolence" | "gratitude" | null,

  // Relationship
  "sender_recipient_relationship": string | null,  // "spouse", "parent-child", "siblings", "friends", "business"

  // Topics (from controlled vocabulary)
  "primary_topics": string[],  // 1-3 main topics from the approved list
  "secondary_topics": string[],  // Additional relevant topics

  // Entities
  "people_mentioned": [
    {
      "name": string,
      "relationship_to_sender": string | null,
      "context": string,
      "confidence": number
    }
  ],

  "places_mentioned": [
    {
      "name": string,
      "role": "written_from" | "mentioned" | "destination",
      "context": string,
      "confidence": number
    }
  ],

  "events_referenced": [
    {
      "name": string,
      "type": "historical" | "personal" | "local",
      "context": string,
      "confidence": number
    }
  ],

  // Historical context
  "time_period_context": string | null,  // "wartime", "peacetime", "depression", etc.
}

PRIMARY TOPICS (use these exact values):
- family/marriage, family/children, family/death-grief, family/separation, family/reunion
- health/illness, health/recovery, health/pregnancy-birth
- work/employment, work/job-loss, finances/hardship, finances/prosperity
- travel/journey, travel/immigration, home/moving, home/property
- correspondence/news-sharing, correspondence/advice, correspondence/gratitude, correspondence/apology
- war/service, war/homefront, religion/faith, community/local-events
- daily-life/weather, daily-life/farming, daily-life/household, daily-life/social

RELATIONSHIP TYPES (use these for sender_recipient_relationship):
- spouse, fiancé/fiancée, romantic-partner
- parent, child, sibling, grandparent, grandchild
- aunt/uncle, nephew/niece, cousin
- in-law, step-relative
- friend, acquaintance
- business-associate, employer, employee
- unknown`;
```

---

## Phase 4: Admin UI for Entity Management

### Entity Review Queue
- List of pending entity matches needing confirmation
- For each: show extracted text, suggested match, context
- Actions: Confirm match, Reject (create new entity), Skip

### People Registry View
- List all known people with letter counts
- Click to see all letters mentioning this person
- Edit aliases, merge duplicates
- Relationship graph visualization

### Connection Explorer
- "Letters mentioning [Person]"
- "Letters about [Topic]"
- "Letters from [Place]"
- "Letters during [Time Period]"

---

## Phase 5: Search Enhancement

### Faceted Search (Filters)
```typescript
interface SearchFilters {
  // Existing
  collection?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;

  // New
  emotionalTone?: EmotionalTone[];
  primaryTopics?: string[];
  personMentioned?: string;  // person ID
  placeMentioned?: string;   // place ID
  relationship?: string;     // sender-recipient relationship type
  timePeriod?: string;
}
```

### Natural Language Search (Future)
```
User: "Show me sad letters about war"
     ↓
AI Translation: { emotionalTone: ['sad', 'anxious'], primaryTopics: ['war/service', 'war/homefront'] }
     ↓
SQL Query execution
```

---

## Implementation Phases

### Phase 1: Schema & Prompt (Week 1)
1. Add new fields to `letters` table
2. Update extraction prompt with new structure
3. Update `ExtractedMetadata` interface
4. Update pipeline to save new fields
5. Re-run extraction on existing transcribed letters

### Phase 2: Entity Tables (Week 2)
1. Create entity tables (people, places, events)
2. Create junction tables (letter_people, etc.)
3. Update extraction to populate entity data
4. Create review queue table

### Phase 3: Admin UI - Entities (Week 3)
1. Entity review queue page
2. People registry CRUD
3. Places registry CRUD
4. Merge/split entity tools

### Phase 4: Search & Connections (Week 4)
1. Add entity-based filtering to admin dashboard
2. "Related letters" feature on letter detail page
3. Connection explorer UI
4. Relationship graph visualization (optional)

### Phase 5: Natural Language Search (Future)
1. Add AI query translation endpoint
2. Update search UI with NL option
3. Consider vector embeddings for semantic similarity

---

## Migration Strategy

### For Existing Letters
1. Letters with `metadataContentStatus = 'AI_DRAFT'`: Re-extract with new prompt
2. Letters with `metadataContentStatus = 'EDITED'` or `'VERIFIED'`:
   - Extract new fields only (don't overwrite human edits)
   - Flag for human review of new entity data

### Backward Compatibility
- Keep existing fields (sender, recipient, tags, etc.)
- New fields are nullable, won't break existing code
- Gradually migrate UI to use new structured data

---

## Example: Molly Letter Extraction

Given the September 1947 letter, new extraction would produce:

```json
{
  "sender": { "name": null, "confidence": 0.0 },
  "recipient": { "name": "Molly", "confidence": 0.95 },
  "location_written": { "name": "Overland Park, Kansas", "confidence": 0.85 },

  "emotional_tone": "desperate",
  "formality_level": "intimate",
  "letter_purpose": "personal",
  "sender_recipient_relationship": "romantic-partner",

  "primary_topics": ["family/marriage", "travel/journey"],
  "secondary_topics": ["family/separation", "correspondence/advice"],

  "people_mentioned": [
    { "name": "George", "relationship_to_sender": "rival", "context": "Molly's other suitor", "confidence": 0.9 },
    { "name": "Barbara", "relationship_to_sender": null, "context": "Molly's daughter, nicknamed Bib", "confidence": 0.85 },
    { "name": "John", "relationship_to_sender": null, "context": "Molly's relative, possibly brother", "confidence": 0.7 }
  ],

  "places_mentioned": [
    { "name": "Manchester, England", "role": "destination", "context": "where Molly lives", "confidence": 0.9 },
    { "name": "Kansas City", "role": "mentioned", "context": "near sender's location", "confidence": 0.85 },
    { "name": "Stockport Road", "role": "mentioned", "context": "where they walked together", "confidence": 0.95 }
  ],

  "events_referenced": [],

  "time_period_context": "post-war",

  "hook": "An American man desperately pleads for his British love to postpone her wedding to another man.",
  "summary": "The writer begs Molly to delay her plans with George for one month so he can fly to England. He recalls their walk down Stockport Road and promises marriage. Despite her rejections, he persists, offering to help her family relocate to America."
}
```

---

## Open Questions

1. **Vector embeddings**: Add now or later? Would enable "find similar letters" but requires pgvector setup.

2. **Cross-collection entities**: Should "John" in Collection A be linkable to "John" in Collection B? (Probably yes, with explicit admin confirmation)

3. **Relationship graph scope**: Just sender→recipient, or all mentioned people?

4. **Historical events list**: Pre-populate common events (Civil War, WWI, WWII, Depression) or fully AI-extracted?

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/src/db/schema.ts` | Add new columns, create entity tables |
| `backend/src/ai/prompts.ts` | New extraction prompt |
| `backend/src/ai/openai.ts` | Update ExtractedMetadata interface |
| `backend/src/pipeline/metadata.ts` | Handle new extraction format |
| `backend/src/dto/letter.dto.ts` | Map new fields to frontend |
| `backend/src/routes/admin/letters.ts` | Add entity filtering |
| `frontend/src/types/Letter.ts` | Add new metadata fields |
| `frontend/src/api/letters.ts` | Add entity query params |
| `frontend/src/pages/admin/AdminDashboard.tsx` | Add new filters |
| NEW: `frontend/src/pages/admin/EntityReview.tsx` | Entity review queue |
| NEW: `frontend/src/pages/admin/PeopleRegistry.tsx` | People management |

---

## Research: OpenAI Best Practices (2025-2026)

Based on research from OpenAI's documentation and cookbook, here are the best practices we should follow:

### Temporal Agents Pattern

The [Temporal Agents with Knowledge Graphs](https://cookbook.openai.com/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents) pattern from OpenAI Cookbook is highly relevant to our use case. Key concepts:

**What Temporal Agents Do:**
- Convert unstructured statements into time-stamped subject-predicate-object triplets
- Track when facts become valid and when they're invalidated
- Enable queries like "What was true on date X?"

**How This Applies to Letters:**
- Each letter is a temporal snapshot of relationships and facts
- "John was in Kansas City" is valid at the letter's date
- Relationships evolve: "engaged" → "married" can be tracked across letters

**Three-Stage Pipeline:**
1. **Temporal Classification** - Is this fact atemporal, static, or dynamic?
2. **Temporal Event Extraction** - Resolve dates to absolute timestamps
3. **Temporal Validity Checking** - Mark outdated entries, link invalidated statements

**For Our Implementation:**
- `letter_people` junction table captures facts at a point in time (letter date)
- Can track relationship evolution across letters (e.g., "romantic-partner" → "spouse")
- Enables queries like "When did John and Mary get married?" by finding the first letter mentioning them as married

### Structured Outputs Best Practices

From [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs):

**Use Strict Mode (Not JSON Mode):**
```typescript
// ✅ Correct - Strict mode with schema
response_format: {
  type: "json_schema",
  json_schema: {
    name: "letter_metadata",
    strict: true,
    schema: metadataSchema
  }
}

// ❌ Legacy - JSON mode only guarantees valid JSON syntax
response_format: { type: "json_object" }
```

**Schema-First Development with Zod:**
The modern pattern is to define schemas in Zod first, then generate JSON Schema for the API:

```typescript
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const PersonMentionedSchema = z.object({
  name: z.string(),
  relationship_to_sender: z.string().nullable(),
  context: z.string(),
  confidence: z.number().min(0).max(1)
});

const MetadataSchema = z.object({
  sender: z.object({
    name: z.string().nullable(),
    confidence: z.number()
  }),
  emotional_tone: z.enum([
    'joyful', 'hopeful', 'neutral', 'anxious', 'sad', 'angry', 'desperate'
  ]).nullable(),
  people_mentioned: z.array(PersonMentionedSchema),
  // ... etc
});

// Convert to JSON Schema for OpenAI
const jsonSchema = zodToJsonSchema(MetadataSchema);
```

**Handling Optional Fields:**
Use `nullable()` with union types - required fields should always be present but can contain null:

```typescript
// ✅ Correct - field is always present, value can be null
emotional_tone: z.enum([...]).nullable()

// ❌ Avoid - field might be missing entirely
emotional_tone: z.enum([...]).optional()
```

### Entity Resolution Strategy

From the [Temporal Agents Cookbook](https://cookbook.openai.com/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents):

**Deduplication Process:**
1. Type-based batching (group people, places, events separately)
2. RapidFuzz similarity clustering for fuzzy matching
3. Medoid selection as canonical representation
4. Cross-check against existing canonicals
5. Acronym deduplication safeguards

**For Our Implementation:**
```typescript
// When processing a new letter with "John" mentioned:
1. Query existing people: WHERE 'John' = ANY(aliases) OR canonical_name ILIKE '%John%'
2. If matches found with high confidence → add to review queue with suggested match
3. If no matches → create new person entry
4. Admin confirms/rejects matches
```

### Document Chunking for Long Letters

From [Azure OpenAI Best Practices](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/best-practices-for-structured-extraction-from-documents-using-azure-openai/4397282):

For longer documents:
- Split into manageable chunks even if full document fits in context
- Sequentially process chunks, updating extracted data
- This prevents context window fatigue and improves accuracy

**For Letters:**
Most historical letters are short enough for single-pass extraction, but for very long letters (5+ pages), consider:
1. Extract entities from each page
2. Merge and dedupe at the letter level
3. Final pass to generate summary/hook from full context

### Production Safeguards

From research:
- **Staged Queues**: Each processing phase has its own queue and worker pool
- **Batch Operations**: Batch database writes and API requests
- **Validation**: Enforce ISO-8601 dates, controlled vocabularies, confidence scores
- **Model Selection**: Start with GPT-4.1 for accuracy, consider GPT-4.1-mini for cost optimization

---

## Updated Implementation Approach

Based on this research, here's the refined approach:

### 1. Use Zod for Schema Definition

Define schemas in Zod, convert to JSON Schema for OpenAI, use same schemas for validation:

```typescript
// backend/src/ai/schemas/metadata.ts
import { z } from 'zod';

export const EmotionalToneEnum = z.enum([
  'joyful', 'hopeful', 'neutral', 'anxious', 'sad', 'angry', 'desperate'
]);

export const MetadataV2Schema = z.object({
  sender: z.object({
    name: z.string().nullable(),
    confidence: z.number().min(0).max(1)
  }),
  // ... full schema
});

export type MetadataV2 = z.infer<typeof MetadataV2Schema>;
```

### 2. Strict Mode API Calls

```typescript
const response = await openai.chat.completions.create({
  model: 'gpt-4.1',
  messages: [...],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'letter_metadata_v2',
      strict: true,
      schema: zodToJsonSchema(MetadataV2Schema)
    }
  }
});
```

### 3. Entity Resolution with Fuzzy Matching

```typescript
import Fuse from 'fuse.js';

async function findMatchingPerson(name: string, collectionId: string) {
  const existingPeople = await db.query.people.findMany();

  const fuse = new Fuse(existingPeople, {
    keys: ['canonical_name', 'aliases'],
    threshold: 0.3, // 70% similarity required
    includeScore: true
  });

  const matches = fuse.search(name);
  return matches.length > 0 ? matches[0] : null;
}
```

### 4. Temporal Relationship Tracking

```typescript
// When processing a letter, track relationship state at that point in time
const letterDate = letter.letterDate;
const relationship = extractedMetadata.sender_recipient_relationship;

// Store in letter_people with temporal context
await db.insert(letterPeople).values({
  letterId: letter.id,
  personId: recipientPerson.id,
  role: 'recipient',
  relationshipToSender: relationship,
  validAt: letterDate, // Relationship was this at letter date
});
```

---

## Sources

- [Temporal Agents with Knowledge Graphs | OpenAI Cookbook](https://cookbook.openai.com/examples/partners/temporal_agents_with_knowledge_graphs/temporal_agents)
- [OpenAI Structured Outputs Documentation](https://platform.openai.com/docs/guides/structured-outputs)
- [Best Practices for Structured Extraction | Microsoft](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/best-practices-for-structured-extraction-from-documents-using-azure-openai/4397282)
- [OpenAI Structured Outputs with Zod](https://www.timsanteford.com/posts/openai-structured-outputs-and-zod-and-zod-to-json-schema/)
- [Introducing Structured Outputs | OpenAI](https://openai.com/index/introducing-structured-outputs-in-the-api/)

---

## Part 2: The "Wise Guide" Experience

### Vision

The public-facing experience isn't a traditional search interface. It's a **conversational guide** - like talking to a wise old historian who has read every letter and can:

- Recommend where to start based on your interests
- Tell stories that connect letters together
- Answer questions about the people, places, and times
- Guide you deeper into rabbit holes you didn't know existed

### Architecture: The Guide System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER CONVERSATION                                    │
│  "I'm interested in love letters from wartime"                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         GUIDE AI LAYER                                       │
│  - Understands user intent                                                   │
│  - Has access to archive knowledge (via RAG or structured queries)          │
│  - Generates conversational responses                                        │
│  - Recommends specific letters with context                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                         KNOWLEDGE LAYER                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Structured DB  │  │  Vector Store   │  │  Knowledge Graph │              │
│  │  (PostgreSQL)   │  │  (Embeddings)   │  │  (Entity Links)  │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### How the Guide Works

**1. Understanding Intent**
```
User: "I'm curious about what daily life was like in the 1940s"

Guide thinks:
- Interest: daily life, 1940s
- Topics: daily-life/*, war/homefront
- Emotional preference: not specified
- Recommend: letters with vivid daily details, maybe contrast wartime/peacetime
```

**2. Querying the Archive**
The Guide AI has access to tools that query our structured data:

```typescript
// Tools available to the Guide AI
const guideTools = [
  {
    name: 'search_letters',
    description: 'Search letters by metadata filters',
    parameters: {
      topics: ['daily-life/farming', 'daily-life/household'],
      dateRange: { from: '1940', to: '1949' },
      emotionalTone: ['neutral', 'hopeful'],
      limit: 5
    }
  },
  {
    name: 'get_letter_details',
    description: 'Get full details of a specific letter',
    parameters: { letterId: 'uuid' }
  },
  {
    name: 'find_related_letters',
    description: 'Find letters connected to this one',
    parameters: {
      letterId: 'uuid',
      connectionType: 'same_person' | 'same_topic' | 'same_period'
    }
  },
  {
    name: 'get_person_story',
    description: 'Get narrative about a person across all their letters',
    parameters: { personId: 'uuid' }
  }
];
```

**3. Generating Responses**
```
Guide response:
"The 1940s in this archive are fascinating - mostly seen through the eyes of
families separated by war. Let me show you a few windows into daily life:

**A Kansas Kitchen, 1947** - An American man describes his typical day to his
British sweetheart, contrasting American conveniences with post-war England.
He talks about cars being necessities, not luxuries.
[Read this letter →]

**Waiting for News, 1943** - A mother writes about rationing, Victory Gardens,
and the constant anxiety of waiting for letters from the front.
[Read this letter →]

Would you like to explore the contrast between American and British daily life?
Or dive into the emotional landscape of wartime waiting?"
```

### The Knowledge Foundation

For the Guide to work well, we need rich knowledge:

**Level 1: Per-Letter Metadata** (Phase 1)
- What we're already planning: topics, tone, entities, relationships

**Level 2: Cross-Letter Knowledge** (Phase 2)
- Person narratives: "John appears in 12 letters, initially as a soldier, later as a husband"
- Relationship arcs: "Mary and John's correspondence shows their relationship evolving"
- Thematic threads: "The theme of separation appears in 45% of wartime letters"

**Level 3: Archive-Wide Insights** (Phase 3)
- Pre-computed summaries: "This collection primarily documents a transatlantic romance"
- Statistical insights: "Most letters from 1947 discuss post-war adjustment"
- Curated starting points: "Start here if you're interested in..."

### Vector Embeddings: When and Why

**What vectors enable:**
- Semantic similarity: "Find letters like this one" (not just same topic)
- Natural language search: User's question → find relevant context
- RAG for the Guide: Give the Guide AI relevant letter excerpts to reference

**Implementation approach:**
```typescript
// Each letter gets an embedding of its full content
interface LetterEmbedding {
  letterId: string;
  embedding: number[];  // 1536-dim for text-embedding-3-small
  chunkType: 'full' | 'summary' | 'hook';
}

// Store in pgvector
CREATE TABLE letter_embeddings (
  id UUID PRIMARY KEY,
  letter_id UUID REFERENCES letters(id),
  chunk_type TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON letter_embeddings USING ivfflat (embedding vector_cosine_ops);
```

**When to use vectors vs structured queries:**
- "Letters about illness" → Structured query (topic filter)
- "Letters that feel desperate" → Structured query (emotional_tone = 'desperate')
- "Letters like this one" → Vector similarity
- "What was the mood in 1862?" → Hybrid: filter by date, aggregate tones, maybe vector for nuance
- Conversational context → Vector retrieval for relevant excerpts

---

## Part 3: Performance at Scale

### Current Scale
- ~100 letters now
- Target: 10,000+ letters eventually

### Performance Considerations

**1. Database Queries**
```sql
-- Entity queries can get expensive with many joins
-- Solution: Materialized views for common patterns

CREATE MATERIALIZED VIEW person_letter_counts AS
SELECT
  p.id as person_id,
  p.canonical_name,
  COUNT(DISTINCT lp.letter_id) as letter_count,
  array_agg(DISTINCT lp.role) as roles
FROM people p
JOIN letter_people lp ON p.id = lp.person_id
GROUP BY p.id, p.canonical_name;

-- Refresh periodically or on metadata extraction completion
REFRESH MATERIALIZED VIEW person_letter_counts;
```

**2. Vector Search at Scale**
- pgvector with IVFFlat index: ~10ms for 10k vectors
- Consider HNSW index for better recall at scale
- Chunk letters if very long (though most historical letters are short)

**3. Guide AI Latency**
- User expects conversational speed (<3s response)
- Cache common query patterns
- Pre-compute "starting point" recommendations
- Stream responses for longer answers

**4. Entity Resolution at Scale**
- Batch process new letters (not real-time)
- Background job for fuzzy matching
- Admin reviews in batches, not one-by-one

### Indexing Strategy

```sql
-- Core query patterns need indexes
CREATE INDEX idx_letters_emotional_tone ON letters(emotional_tone);
CREATE INDEX idx_letters_primary_topics ON letters USING GIN(primary_topics);
CREATE INDEX idx_letter_people_person ON letter_people(person_id);
CREATE INDEX idx_letter_places_place ON letter_places(place_id);

-- Full-text search for transcript/summary
CREATE INDEX idx_letters_fts ON letters
  USING GIN(to_tsvector('english', COALESCE(transcription_text, '') || ' ' || COALESCE(summary, '')));
```

---

## Part 4: Natural Language → Structured Query

### The Translation Layer

When a user types a natural language query, we translate it to structured filters:

```typescript
// Query translation prompt
const QUERY_TRANSLATION_PROMPT = `You are a query translator for a historical letter archive.

Given a user's natural language query, extract structured search parameters.

Available filters:
- topics: array of topic codes (family/marriage, health/illness, war/service, etc.)
- emotionalTone: joyful | hopeful | neutral | anxious | sad | angry | desperate
- dateRange: { from: 'YYYY', to: 'YYYY' }
- personName: string (to search in people mentioned)
- placeName: string (to search in places mentioned)
- relationship: spouse | parent | child | sibling | friend | etc.
- freeText: string (for keyword search in content)

Output JSON only.

Examples:
"sad letters about war" → { "emotionalTone": "sad", "topics": ["war/service", "war/homefront"] }
"letters from mothers to sons" → { "relationship": "parent", "freeText": "son" }
"1860s letters about farming" → { "dateRange": {"from": "1860", "to": "1869"}, "topics": ["daily-life/farming"] }
`;

interface ParsedQuery {
  topics?: string[];
  emotionalTone?: EmotionalTone;
  dateRange?: { from: string; to: string };
  personName?: string;
  placeName?: string;
  relationship?: string;
  freeText?: string;
}
```

### Hybrid Search Flow

```
User: "letters where someone is desperately in love"
           ↓
┌─────────────────────────────────────────┐
│  1. Query Translation (fast AI call)    │
│  → { emotionalTone: 'desperate',        │
│       topics: ['family/marriage'],      │
│       relationship: 'romantic-partner' }│
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  2. Structured Query                     │
│  SELECT * FROM letters                   │
│  WHERE emotional_tone = 'desperate'      │
│    AND 'family/marriage' = ANY(topics)  │
│    AND sender_recipient_relationship    │
│        = 'romantic-partner'              │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  3. (Optional) Vector Re-ranking        │
│  Embed user query, re-rank results      │
│  by semantic similarity                  │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  4. Results with Context                 │
│  Return letters + why they match         │
└─────────────────────────────────────────┘
```

---

## Part 5: Connection UI/UX

### How Users Navigate Relationships

**1. Letter Detail Page - Connections Panel**
```
┌─────────────────────────────────────────────────────────────────┐
│  Letter from John to Mary, September 1947                       │
│  ─────────────────────────────────────────────────────────────  │
│  [Transcript content...]                                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  CONNECTIONS                                             │   │
│  │                                                          │   │
│  │  👤 People in this letter:                               │   │
│  │     • Mary (recipient) - 12 other letters                │   │
│  │     • George (mentioned) - 8 other letters               │   │
│  │     • Barbara (mentioned) - 5 other letters              │   │
│  │                                                          │   │
│  │  📍 Places mentioned:                                    │   │
│  │     • Manchester, England - 15 letters                   │   │
│  │     • Stockport Road - 3 letters                         │   │
│  │                                                          │   │
│  │  📚 Similar letters:                                     │   │
│  │     • "Another desperate plea..." (Sept 4, 1947)         │   │
│  │     • "Hopes rekindled..." (Sept 9, 1947)               │   │
│  │                                                          │   │
│  │  🏷️ Explore this topic:                                  │   │
│  │     • family/marriage (23 letters)                       │   │
│  │     • travel/journey (18 letters)                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**2. Person Page**
```
┌─────────────────────────────────────────────────────────────────┐
│  MARY                                                           │
│  Mentioned in 12 letters (1947)                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Relationships:                                                 │
│  • Recipient of letters from: [Unknown American man]            │
│  • Mother of: Barbara                                           │
│  • Related to: John (possibly brother)                          │
│  • Engaged to: George (as of Sept 1947)                         │
│                                                                 │
│  Their Story:                                                   │
│  "Mary appears in a series of passionate letters from an        │
│   American man, likely met during WWII. The letters document    │
│   his desperate attempts to win her back from another suitor,   │
│   George. The correspondence reveals a transatlantic romance    │
│   complicated by distance, timing, and competing affections."   │
│                                                                 │
│  Timeline:                                                      │
│  ├── Aug 1947: First letter, proposal contemplated              │
│  ├── Sept 4: Pleading for one more month                        │
│  ├── Sept 9: Joy at her response                                │
│  ├── Sept 21: Heartbreak at reversal                            │
│  └── Sept 23: Frustration and accusations                       │
│                                                                 │
│  [View all 12 letters →]                                        │
└─────────────────────────────────────────────────────────────────┘
```

**3. Relationship Graph (Optional Advanced Feature)**
```
Interactive visualization showing:
- Nodes: People
- Edges: Letters between them (thickness = frequency)
- Clustering: By collection, time period, or topic
- Click node → see that person's page
- Click edge → see letters between those people
```

---

## Part 6: Revised Implementation Phases

### Phase 1: Enhanced Extraction (Foundation)
**Goal:** Extract richer, structured metadata from each letter

- [ ] Add new fields to `letters` table (tone, topics, etc.)
- [ ] Create Zod schema for structured outputs
- [ ] Update extraction prompt for V2 format
- [ ] Update pipeline to save new fields
- [ ] Test on existing transcribed letters
- [ ] Re-extract metadata for all letters

**Deliverable:** Each letter has rich, structured metadata

### Phase 2: Entity Registry (Connections)
**Goal:** Track people, places, events across letters

- [ ] Create entity tables (people, places, events)
- [ ] Create junction tables with temporal context
- [ ] Add entity extraction to pipeline
- [ ] Build fuzzy matching for entity resolution
- [ ] Create admin review queue UI
- [ ] Process existing letters to populate entities

**Deliverable:** Entities linked across letters, admin can confirm matches

### Phase 3: Vector Embeddings (Semantic Search)
**Goal:** Enable "find similar" and semantic search

- [ ] Add pgvector extension
- [ ] Create embeddings table
- [ ] Generate embeddings for all letters
- [ ] Build similarity search endpoint
- [ ] Add "similar letters" to letter detail page

**Deliverable:** Users can find semantically similar letters

### Phase 4: Search & Browse (User Access)
**Goal:** Public users can search and explore

- [ ] Natural language → structured query translation
- [ ] Faceted search UI with new filters
- [ ] Connection explorer UI
- [ ] Person/place detail pages
- [ ] "Related letters" on letter detail

**Deliverable:** Rich search and browsing experience

### Phase 5: The Guide (Conversational AI)
**Goal:** The "wise old man" experience

- [ ] Design Guide AI prompt and persona
- [ ] Build Guide API endpoint with tool access
- [ ] Create conversational UI
- [ ] Pre-compute starting points and recommendations
- [ ] Generate narrative summaries for people/collections

**Deliverable:** Conversational guide that knows the archive

---

---

## Part 7: Dual-Mode Experience

The archive should support **two complementary modes** of exploration:

### Mode 1: Manual Browse/Search
Traditional interface for users who want direct control:

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSE THE ARCHIVE                                             │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  [Search: ____________________] [🔍]                            │
│                                                                 │
│  FILTERS                          RESULTS (23 letters)         │
│  ┌─────────────────────┐          ┌─────────────────────────┐  │
│  │ 📅 Time Period      │          │ ▸ Letter from John...   │  │
│  │   ○ 1840s           │          │   Sept 21, 1947         │  │
│  │   ● 1940s           │          │   "A desperate plea..." │  │
│  │   ○ 1950s           │          │                         │  │
│  │                     │          │ ▸ Letter from Mary...   │  │
│  │ 💭 Emotional Tone   │          │   Aug 10, 1947          │  │
│  │   ☑ Desperate       │          │   "Waiting for news..." │  │
│  │   ☑ Hopeful         │          │                         │  │
│  │   ☐ Joyful          │          │ ▸ ...                   │  │
│  │                     │          │                         │  │
│  │ 📚 Topics           │          │                         │  │
│  │   ☑ Love/Marriage   │          │                         │  │
│  │   ☐ War             │          │                         │  │
│  │   ☐ Daily Life      │          │                         │  │
│  │                     │          │                         │  │
│  │ 👤 People           │          │                         │  │
│  │   [Search people]   │          │                         │  │
│  │   • Mary (12)       │          │                         │  │
│  │   • John (8)        │          │                         │  │
│  └─────────────────────┘          └─────────────────────────┘  │
│                                                                 │
│  [💬 Ask the Archivist instead...]                              │
└─────────────────────────────────────────────────────────────────┘
```

**Features:**
- Faceted filters (checkboxes, dropdowns)
- Type-ahead search
- Results with preview hooks
- Clear, predictable behavior
- No AI required for basic use

### Mode 2: The Archivist (Guided Experience)
Conversational AI with distinct personality:

```
┌─────────────────────────────────────────────────────────────────┐
│  THE ARCHIVIST                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  [Portrait/Avatar of elderly figure]                            │
│                                                                 │
│  "Ah, welcome to the archive. I've spent many years with        │
│   these letters - they never cease to reveal new stories.       │
│                                                                 │
│   What brings you here today? Are you searching for someone     │
│   in particular, or shall I show you something remarkable?"     │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  [User]: I'm curious about love letters                         │
│                                                                 │
│  [Archivist]: *adjusts spectacles*                              │
│                                                                 │
│  "Love letters... we have quite a few, though they're rarely    │
│   what you might expect. The most passionate ones often come    │
│   from separation - war, immigration, circumstance.             │
│                                                                 │
│   There's a collection from 1947 that haunts me still. An       │
│   American man, likely a soldier who'd been stationed in        │
│   England, desperately trying to win back a woman named Molly.  │
│   His letters span just weeks, but the emotional journey...     │
│                                                                 │
│   Shall I show you where his story begins? Or would you         │
│   prefer something from an earlier era - perhaps Civil War      │
│   sweethearts?"                                                 │
│                                                                 │
│  [Type your response...]                                        │
│                                                                 │
│  [🔍 Switch to manual search]                                   │
└─────────────────────────────────────────────────────────────────┘
```

### The Archivist's Personality

**Core traits:**
- **Wise and patient** - never rushes, savors the stories
- **Curious about you** - asks questions, wants to understand your interest
- **Emotionally intelligent** - can sense when you want facts vs stories
- **Humble** - admits uncertainty, says "I believe..." not "definitely..."
- **Slightly old-fashioned** - vocabulary and cadence of an older era
- **Passionate** - genuinely moved by the letters, has favorites

**Voice examples:**
```
Instead of: "Here are 5 results matching your query"
Says: "Ah, this reminds me of several letters. Let me show you three that I find particularly moving..."

Instead of: "No results found"
Says: "Hmm, I'm not finding quite what you're looking for in my collection. But there's something adjacent that might interest you..."

Instead of: "Click here to read more"
Says: "If you'd like to read his words yourself, I can show you the letter. Sometimes my descriptions don't do justice to the original hand."
```

**Emotional range:**
- Joy: "Oh, this one makes me smile every time..."
- Sadness: "This letter... I must warn you, it's quite heavy."
- Wonder: "I've read this a hundred times and still find new details."
- Uncertainty: "The handwriting here is difficult. I believe it says... but I could be wrong."

**The Archivist's knowledge:**
- Knows all extracted metadata
- Can reference specific letters by memory
- Understands relationships between letters
- Has "opinions" about which letters are most interesting
- Can tell narrative arcs across multiple letters

### Seamless Mode Switching

Users should be able to fluidly move between modes:

```
Manual Search                     The Archivist
     │                                  │
     │  "Ask the Archivist about        │
     │   these results"                 │
     ├─────────────────────────────────→│
     │                                  │
     │  "Show me the filters            │
     │   for what we discussed"         │
     │←─────────────────────────────────┤
     │                                  │
```

**Context preservation:**
- If you search manually, then ask the Archivist, they know what you were looking at
- If the Archivist suggests letters, you can see them in the browse view with those filters applied
- Your journey is saved - you can return to where you were

---

## Part 8: Implementation Priority (Revised)

Given the dual-mode vision, here's the updated priority:

### Foundation (Required for Both Modes)
1. **Phase 1: Enhanced Extraction** - Rich metadata for every letter
2. **Phase 2: Entity Registry** - People, places connected across letters

### Manual Mode (Simpler, Do First)
3. **Phase 4a: Faceted Browse UI** - Filters, search, results
4. **Phase 4b: Connection Pages** - Person pages, place pages, related letters

### Guided Mode (Complex, Do After Manual Works)
5. **Phase 3: Vector Embeddings** - For semantic "similar letters" and RAG
6. **Phase 5: The Archivist** - Conversational AI with personality

### Why This Order?
- Manual mode validates that our metadata is useful
- Manual mode is usable even if AI has issues
- Archivist can reference manual mode ("try the search filters for...")
- We learn what questions people ask before building the AI

---

## Design Decisions

### The Archivist Identity

**Name:** TBD - needs a good name that fits the wise, old historian personality. Options to consider:
- A classic name like "Edgar", "Theodore", "Clement"
- A title like "The Keeper", "The Curator"
- Something that hints at their nature: "Alistair" (defender of memory)

**Visual Representation:** Text-only for now. No avatar, portrait, or visual element. The personality comes through entirely in the writing style and conversational tone.

**Memory Across Sessions:** Yes - the Archivist remembers returning visitors:
- "Ah, you've returned! Last time we were exploring the 1947 letters..."
- "I've been thinking about that question you asked about Mary..."
- Requires: session storage (localStorage or database) to track conversation history per user

**Personality Consistency:** The Archivist has ONE consistent personality across all collections. They don't "know some collections better" - they're equally familiar with the entire archive. This keeps the experience simple and avoids confusing users.

**Fallback Behavior:** When AI fails, graceful degradation:
- "I seem to be having trouble with my memory today. Perhaps try the search filters while I collect myself?"
- Automatically surface the manual browse mode as an alternative
- Log errors for debugging but don't expose technical details to users

### Open Questions (Remaining)

1. **Voice input:** Should users be able to speak to the Archivist? (Lower priority, can add later)

2. **Archivist's actual name:** Need to decide on the perfect name that fits the personality
