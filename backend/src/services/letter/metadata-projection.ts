import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { letters } from '../../db/index.js';

export interface MetadataProjectionUpdates {
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  extractedDate?: string | null;
  emotionalTone?: string | null;
  senderRecipientRelationship?: string | null;
  primaryTopics?: string[] | null;
  tags?: string[] | null;
}

const structuredKeyByField = {
  sender: 'sender',
  recipient: 'recipient',
  locationWritten: 'location_written',
  hook: 'hook',
  summary: 'summary',
  extractedDate: 'extracted_date',
  emotionalTone: 'emotional_tone',
  senderRecipientRelationship: 'sender_recipient_relationship',
  primaryTopics: 'primary_topics',
  tags: 'primary_topics',
} as const;

const legacyKeyByField = {
  sender: 'sender',
  recipient: 'recipient',
  locationWritten: 'locationWritten',
  hook: 'hook',
  summary: 'summary',
  extractedDate: 'extractedDate',
  emotionalTone: 'emotionalTone',
  senderRecipientRelationship: 'senderRecipientRelationship',
  primaryTopics: 'tags',
  tags: 'tags',
} as const;

function projectDocument(
  existing: unknown,
  updates: MetadataProjectionUpdates,
  keyByField: typeof structuredKeyByField | typeof legacyKeyByField,
): Record<string, unknown> | null {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return null;

  const projected = { ...(existing as Record<string, unknown>) };
  for (const [field, value] of Object.entries(updates) as Array<
    [keyof MetadataProjectionUpdates, MetadataProjectionUpdates[keyof MetadataProjectionUpdates]]
  >) {
    if (value === undefined) continue;
    const key = keyByField[field];
    projected[key] = field === 'tags' || field === 'primaryTopics'
      ? value ?? []
      : value;
  }
  return projected;
}

/**
 * Applies flattened reviewer fields to the structured metadata projection.
 * A missing structured document remains missing; callers do not invent a
 * partial AI result merely because a reviewer prefilled one field.
 */
export function projectStructuredMetadata(
  existing: unknown,
  updates: MetadataProjectionUpdates,
): Record<string, unknown> | null {
  return projectDocument(existing, updates, structuredKeyByField);
}

/** Update the historical camelCase metadata document without promoting it to V2. */
export function projectLegacyMetadata(
  existing: unknown,
  updates: MetadataProjectionUpdates,
): Record<string, unknown> | null {
  return projectDocument(existing, updates, legacyKeyByField);
}

interface StoredMetadataDocuments {
  metadataV2Json?: unknown;
  metadataJson?: unknown;
}

/**
 * Keep modern mirrored documents coherent, but never promote an unvalidated
 * historical camelCase document into the V2 column.
 */
export function buildMetadataDocumentProjectionPatch(
  stored: StoredMetadataDocuments,
  updates: MetadataProjectionUpdates,
): { metadataV2Json?: Record<string, unknown>; metadataJson?: Record<string, unknown> } {
  const structured = projectStructuredMetadata(stored.metadataV2Json, updates);
  if (structured) {
    return { metadataV2Json: structured, metadataJson: structured };
  }

  const legacy = projectLegacyMetadata(stored.metadataJson, updates);
  return legacy ? { metadataJson: legacy } : {};
}

type SetBasedProjectionField = 'sender' | 'recipient' | 'locationWritten';

function jsonPath(field: SetBasedProjectionField, legacy = false): SQL {
  if (field === 'sender') return sql`'{sender}'::text[]`;
  if (field === 'recipient') return sql`'{recipient}'::text[]`;
  return legacy
    ? sql`'{locationWritten}'::text[]`
    : sql`'{location_written}'::text[]`;
}

/**
 * Set-based counterpart used by canonical entity renames. Both stored JSON
 * projections change in the same statement as their flattened column.
 */
export function buildStructuredMetadataSqlPatch(
  field: SetBasedProjectionField,
  value: string | null,
) {
  const v2Path = jsonPath(field);
  const legacyPath = jsonPath(field, true);
  const jsonValue = value === null
    ? sql`'null'::jsonb`
    : sql`to_jsonb(${value}::text)`;
  const updateDocument = (column: SQLWrapper, path: SQL) => sql`
    CASE
      WHEN ${column} IS NULL THEN NULL
      ELSE jsonb_set(${column}, ${path}, ${jsonValue}, true)
    END
  `;

  return {
    metadataV2Json: updateDocument(letters.metadataV2Json, v2Path),
    metadataJson: sql`
      CASE
        WHEN ${letters.metadataJson} IS NULL THEN NULL
        WHEN ${letters.metadataV2Json} IS NULL
          THEN jsonb_set(${letters.metadataJson}, ${legacyPath}, ${jsonValue}, true)
        ELSE jsonb_set(${letters.metadataJson}, ${v2Path}, ${jsonValue}, true)
      END
    `,
  };
}
