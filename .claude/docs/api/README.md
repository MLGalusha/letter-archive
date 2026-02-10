# API Reference

REST API at `backend/src/routes/`. Public endpoints unauthenticated; admin requires auth.

## By Domain

| Domain | Doc | Routes |
|--------|-----|--------|
| Public | [public.md](public.md) | Letters, collections, images |
| Admin | [admin.md](admin.md) | Letter CRUD, bulk operations |
| Processing | [processing.md](processing.md) | Transcription, metadata extraction |

## Error Format

```json
{ "error": "Message", "details": [...] }
```

Status codes: 400 (validation), 404 (not found), 500 (server error)
