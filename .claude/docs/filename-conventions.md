# Filename Conventions

## Overview

Letter images follow a strict naming convention that encodes metadata directly in the filename. This enables automatic parsing during upload to extract collection, date, type, and page information.

## Location

- Frontend parser: `frontend/src/utils/filename-parser.ts`
- Backend parser: `backend/src/services/filename-parser.ts`

Both parsers use identical logic and must be kept in sync.

---

## Format

```
{collectionCode}-{dateRaw}-{type}{typeSequence}[-{pageNumber}].{ext}
```

| Part | Format | Required | Description |
|------|--------|----------|-------------|
| `collectionCode` | 3 digits | Yes | Collection identifier (e.g., `003`) |
| `dateRaw` | 8 chars | Yes | Date as YYYYMMDD with X for unknown (e.g., `18860314`, `18XX0706`) |
| `type` | 1 letter | Yes | Document type code (see Type Codes below) |
| `typeSequence` | 2 digits | Yes | Sequence within same date/type (e.g., `01`, `02`) |
| `pageNumber` | 2 digits | No | Page number, defaults to `01` if omitted |
| `ext` | string | Yes | File extension (e.g., `jpg`, `png`) |

---

## Examples

### Standard Multi-Page Letter

```
003-18860314-L01-01.jpg   # Collection 003, March 14 1886, Letter #1, Page 1
003-18860314-L01-02.jpg   # Collection 003, March 14 1886, Letter #1, Page 2
003-18860314-L01-03.jpg   # Collection 003, March 14 1886, Letter #1, Page 3
```

### Single-Page Letter (page number omitted)

```
005-19150813-L01.jpg      # Collection 005, Aug 13 1915, Letter #1, Page 1 (implied)
```

### Unknown Date Parts

```
003-18XX0706-L01-01.jpg   # Collection 003, July 6 in 1800s (exact year unknown)
001-XXXXXXXX-L01-01.jpg   # Collection 001, completely unknown date
003-1889XXXX-L01-01.jpg   # Collection 003, sometime in 1889 (month/day unknown)
```

### Different Document Types

```
003-18860314-C01-01.jpg   # Cover (envelope) for letter dated March 14 1886
003-18860314-E01-01.jpg   # Ephemera related to same date
003-18860314-P01-01.jpg   # Photo related to same date
```

### Multiple Items Same Date

```
003-18860314-L01-01.jpg   # First letter on this date
003-18860314-L02-01.jpg   # Second letter on this date
003-18860314-C01-01.jpg   # Cover for first letter
003-18860314-C02-01.jpg   # Cover for second letter
```

---

## Type Codes

| Code | Name | Description |
|------|------|-------------|
| `L` | Letter | Primary letter content |
| `C` | Cover | Envelope or cover |
| `P` | Photo | Photograph |
| `E` | Ephemera | Miscellaneous items (tickets, cards, etc.) |
| `V` | Voice | Audio recording transcription |
| `A` | Article | Newspaper article or clipping |
| `D` | Diary | Diary entry |
| `N` | Card | Greeting card |
| `T` | Telegram | Telegram |

Any single letter A-Z is accepted for flexibility, but the above are the known types with human-readable names.

---

## Date Handling

### Date Confidence

The parser determines date confidence based on the `dateRaw` value:

| Pattern | Confidence | ISO Date |
|---------|------------|----------|
| `18860314` | `exact` | `1886-03-14` |
| `18XX0706` | `unknown` | `null` |
| `1889XXXX` | `unknown` | `null` |
| `XXXXXXXX` | `unknown` | `null` |

### Sorting with Unknown Dates

When sorting by date, `X` characters are replaced with `0` for ordering:
- `18XXXXXX` → `18000000` (sorts at start of 1800s)
- `1889XXXX` → `18890000` (sorts at start of 1889)

This means letters with unknown dates sort at the beginning of their known range.

---

## Related Items

Documents are grouped by `(collectionId, dateRaw, typeSequence)`:

```
# These are all related - same date and sequence:
003-18860314-L01-01.jpg   # Primary letter, page 1
003-18860314-L01-02.jpg   # Primary letter, page 2
003-18860314-C01-01.jpg   # Cover for this letter
003-18860314-E01-01.jpg   # Extra item for this letter

# These are a separate group - different sequence:
003-18860314-L02-01.jpg   # Different letter, same date
003-18860314-C02-01.jpg   # Cover for the second letter
```

The L-type (Letter) is considered the **primary** of each group. When filtering by workflow state, the filter applies to the primary's state, not individual items.

---

## Regex Pattern

```javascript
const FILENAME_PATTERN = /^(\d{3})-([\dX]{8})-([A-Z])(\d{2})(?:-(\d{2}))?\.\w+$/i;
```

**Groups**:
1. Collection code (3 digits)
2. Date raw (8 chars, digits or X)
3. Type (single letter)
4. Type sequence (2 digits)
5. Page number (2 digits, optional)

---

## Utility Functions

### Frontend (`frontend/src/utils/filename-parser.ts`)

```typescript
// Parse a filename into components
parseFilename(filename: string): ParsedFilename | null

// Check if filename matches pattern
isValidFilename(filename: string): boolean

// Get file extension
getFileExtension(filename: string): string

// Generate filename with unknown date
generateFilename(original, collection, type, seq, page): string

// Update type code in filename
updateFilenameType(filename: string, newType: LetterType): string

// Calculate sort order for filename
calculateSortOrder(parsed: ParsedFilename): number

// Map type to category ('letters' | 'covers' | 'extras')
typeToCategory(type: LetterType): string

// Map category back to type
categoryToType(category: string): LetterType

// Get human-readable type name
getTypeName(type: LetterType): string
```

### Backend (`backend/src/services/filename-parser.ts`)

```typescript
// Parse a filename into components
parseFilename(filename: string): ParsedFilename | null

// Check if filename matches pattern
isValidFilename(filename: string): boolean
```

---

## Related Docs

- [api-contracts.md](api-contracts.md) - Upload endpoint details
- [processing-pipeline.md](processing-pipeline.md) - How uploads trigger processing
- [database-schema.md](database-schema.md) - How parsed data is stored
