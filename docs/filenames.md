# Filename Conventions

Parsers: `frontend/src/utils/filename-parser.ts`, `backend/src/services/filename-parser.ts` (keep in sync)

## Format

```
{collection}-{dateRaw}-{type}{seq}[-{page}].{ext}
```

| Part | Format | Example |
|------|--------|---------|
| collection | 3 digits | `003` |
| dateRaw | 8 chars (X=unknown) | `18860314`, `18XX0706` |
| type | 1 letter | `L`, `C`, `E` |
| seq | 2 digits | `01` |
| page | 2 digits (optional) | `01` |

**Examples:**
```
003-18860314-L01-01.jpg  # Letter #1, page 1
003-18860314-L01-02.jpg  # Letter #1, page 2
003-18860314-C01-01.jpg  # Cover for letter #1
003-18XX0706-L01-01.jpg  # Unknown year
```

## Type Codes

| Code | Name |
|------|------|
| L | Letter (primary) |
| C | Cover |
| P | Photo |
| E | Ephemera |
| V | Voice |
| A | Article |
| D | Diary |
| N | Card |
| T | Telegram |

## Related Items

Grouped by `(collection, dateRaw, seq)`. L-type is the **primary**—workflow filters apply to it.

## Date Confidence

- `18860314` → exact, ISO date
- `18XX0706` or `1889XXXX` → unknown, null date
- Unknown dates sort at start of range (X → 0)

## Regex

```javascript
/^(\d{3})-([\dX]{8})-([A-Z])(\d{2})(?:-(\d{2}))?\.\w+$/i
```

Groups: collection, dateRaw, type, seq, page (optional)
