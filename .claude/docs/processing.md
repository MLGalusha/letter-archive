# Processing Pipeline

Location: `backend/src/pipeline/`, `backend/src/ai/openai.ts`

## Workflow

```
UPLOADED → TRANSCRIBING → TRANSCRIBED → (confirm) → METADATA_EXTRACTING → METADATA_DRAFTED → REVIEWED
```

## Phase 1: Transcription

**Trigger:** L-type with workflow=UPLOADED, transcriptionStatus=PENDING

1. Set workflow=TRANSCRIBING, status=RUNNING
2. For each page, call OpenAI Vision API
3. Combine with `--- Page N ---` separators
4. Set workflow=TRANSCRIBED, status=SUCCESS

**Human Gate:** Admin must confirm transcript before Phase 2.

## Phase 2: Metadata Extraction

**Trigger:** workflow=TRANSCRIBED, transcript confirmed, metadataStatus=PENDING

1. Set workflow=METADATA_EXTRACTING, status=RUNNING
2. Send transcript to OpenAI for structured extraction
3. Extract: sender, recipient, location, hook, summary, tags, date
4. Set workflow=METADATA_DRAFTED, status=SUCCESS

## Type Restriction

**Only L-type (Letter) documents are processed.** Other types (C, E, P) are related items only.

## Error Handling

- Max 3 attempts per phase
- Status=FAILED with error message stored
- Workflow stays in *-ING state for retry

## Job Status Fields

| Field | Purpose |
|-------|---------|
| `transcriptionStatus` | PENDING → RUNNING → SUCCESS/FAILED |
| `metadataStatus` | PENDING → RUNNING → SUCCESS/FAILED |
| `transcriptionAttemptCount` | Retry counter (max 3) |
| `metadataAttemptCount` | Retry counter (max 3) |

## Two-Track Content Status

Independent of workflow, tracks verification state:

| Field | Values |
|-------|--------|
| `transcript_status` | EMPTY → AI_DRAFT → EDITED → VERIFIED |
| `metadata_content_status` | EMPTY → AI_DRAFT → EDITED → VERIFIED |
