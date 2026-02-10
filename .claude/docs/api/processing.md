# Processing API

Routes: `backend/src/routes/admin/letters.ts` (processing controls)

## Status

### GET /admin/processing/status

```json
{
  "isRunning": true,
  "isPaused": false,
  "currentJob": { "letterId": "...", "type": "transcription" },
  "completed": 5,
  "failed": 1,
  "total": 20,
  "errors": ["uuid: Error message"]
}
```

---

## Controls

### POST /admin/processing/start-transcription
Body: `{ collectionCode?: "003" }`
Processes L-type letters with workflow=UPLOADED.

### POST /admin/processing/start-metadata
Body: `{ collectionCode?: "003" }`
Processes L-type letters with workflow=TRANSCRIBED and confirmed transcript.

### POST /admin/processing/pause
### POST /admin/processing/resume
### POST /admin/processing/abort
Reverts current job, stops processing.
