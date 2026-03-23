/**
 * Name Propagation Service
 *
 * When a human reviewer changes a sender/recipient name, this service
 * propagates the change through all metadata fields (summary, hook,
 * metadataV2Json, entityExtractionJson) using simple find-replace.
 *
 * No AI calls — purely deterministic string replacement.
 */

import { eq } from 'drizzle-orm';
import { db, letters, type Letter } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { PLACEHOLDERS, replacePlaceholder, findOrphanedPlaceholders, isPlaceholderValue } from '../utils/placeholders.js';

const log = createLogger({ module: 'name-propagation' });

export interface PropagateNameParams {
  letterId: string;
  field: 'sender' | 'recipient';
  oldName: string;
  newName: string;
}

export interface PropagateNameResult {
  letter: Letter;
  fieldsUpdated: string[];
}

/**
 * Build a regex that matches the old name as a whole word, case-insensitive.
 * Escapes regex special characters in the name.
 */
function buildWholeWordRegex(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'gi');
}

/**
 * Extract first name from a full name string.
 * "Molly Jean Smith" -> "Molly"
 * "Smith" -> "Smith" (single word stays as-is)
 */
function getFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || fullName;
}

/**
 * Replace old name with new name in a string using whole-word matching.
 * Returns the original string if no match found.
 */
function replaceInString(text: string, oldName: string, newName: string): string {
  const regex = buildWholeWordRegex(oldName);
  return text.replace(regex, newName);
}

/**
 * Replace old name with first-name-only in hook text.
 * Hooks are short and punchy — full names feel clunky.
 */
function replaceInHook(text: string, oldName: string, newName: string): string {
  const regex = buildWholeWordRegex(oldName);
  const firstName = getFirstName(newName);
  return text.replace(regex, firstName);
}

/**
 * Deep-replace a name throughout a JSON-like object.
 * Walks all string values and replaces whole-word matches.
 */
function deepReplaceInValue(value: unknown, oldName: string, newName: string): unknown {
  if (typeof value === 'string') {
    return replaceInString(value, oldName, newName);
  }
  if (Array.isArray(value)) {
    return value.map(item => deepReplaceInValue(item, oldName, newName));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepReplaceInValue(val, oldName, newName);
    }
    return result;
  }
  return value;
}

/**
 * Update metadataV2Json with the new name.
 * Targets: sender/recipient name fields, summary, hook (first name), ai_notes,
 * notable_quotes context.
 */
function propagateInMetadataV2(
  metadata: Record<string, unknown>,
  field: 'sender' | 'recipient',
  oldName: string,
  newName: string,
): Record<string, unknown> {
  const updated = { ...metadata };

  // Update the sender/recipient name object
  const nameObj = updated[field] as { name?: string | null; confidence?: number } | undefined;
  if (nameObj && typeof nameObj === 'object') {
    const currentName = nameObj.name;
    if (currentName && buildWholeWordRegex(oldName).test(currentName)) {
      updated[field] = { ...nameObj, name: replaceInString(currentName, oldName, newName) };
    }
  }

  // Update summary
  if (typeof updated.summary === 'string') {
    updated.summary = replaceInString(updated.summary, oldName, newName);
  }

  // Update hook (use first name for brevity)
  if (typeof updated.hook === 'string') {
    updated.hook = replaceInHook(updated.hook, oldName, newName);
  }

  // Update ai_notes (structured array in metadataV2Json)
  if (Array.isArray(updated.ai_notes)) {
    updated.ai_notes = deepReplaceInValue(updated.ai_notes, oldName, newName);
  } else if (typeof updated.ai_notes === 'string') {
    // Legacy string format fallback
    updated.ai_notes = replaceInString(updated.ai_notes, oldName, newName);
  }

  // Update notable_quotes contexts
  if (Array.isArray(updated.notable_quotes)) {
    updated.notable_quotes = (updated.notable_quotes as Record<string, unknown>[]).map(quote => ({
      ...quote,
      context: typeof quote.context === 'string'
        ? replaceInString(quote.context, oldName, newName)
        : quote.context,
    }));
  }

  return updated;
}

/**
 * Update entityExtractionJson with the new name.
 * Targets: people[].name, people[].relationship_to_sender, people[].narrative,
 * people[].emotional_significance, people[].quotes[].context,
 * places[].associated_people, relationships[].person_a/person_b,
 * person_place_connections[].person_name
 */
function propagateInEntityExtraction(
  entities: Record<string, unknown>,
  oldName: string,
  newName: string,
): Record<string, unknown> {
  const updated = { ...entities };

  // Update people array
  if (Array.isArray(updated.people)) {
    updated.people = (updated.people as Record<string, unknown>[]).map(person => {
      const p = { ...person };

      // Update person name
      if (typeof p.name === 'string' && buildWholeWordRegex(oldName).test(p.name)) {
        p.name = replaceInString(p.name, oldName, newName);
      }

      // Update aliases
      if (Array.isArray(p.aliases)) {
        p.aliases = (p.aliases as string[]).map(alias =>
          buildWholeWordRegex(oldName).test(alias)
            ? replaceInString(alias, oldName, newName)
            : alias
        );
      }

      // Update relationship_to_sender
      if (typeof p.relationship_to_sender === 'string') {
        p.relationship_to_sender = replaceInString(p.relationship_to_sender, oldName, newName);
      }

      // Update narrative
      if (typeof p.narrative === 'string') {
        p.narrative = replaceInString(p.narrative, oldName, newName);
      }

      // Update emotional_significance
      if (typeof p.emotional_significance === 'string') {
        p.emotional_significance = replaceInString(p.emotional_significance, oldName, newName);
      }

      // Update quotes contexts
      if (Array.isArray(p.quotes)) {
        p.quotes = (p.quotes as Record<string, unknown>[]).map(quote => ({
          ...quote,
          context: typeof quote.context === 'string'
            ? replaceInString(quote.context, oldName, newName)
            : quote.context,
        }));
      }

      // Update details
      if (Array.isArray(p.details)) {
        p.details = (p.details as Record<string, unknown>[]).map(detail => ({
          ...detail,
          detail: typeof detail.detail === 'string'
            ? replaceInString(detail.detail, oldName, newName)
            : detail.detail,
        }));
      }

      return p;
    });
  }

  // Update places: associated_people arrays, narrative
  if (Array.isArray(updated.places)) {
    updated.places = (updated.places as Record<string, unknown>[]).map(place => {
      const pl = { ...place };

      if (Array.isArray(pl.associated_people)) {
        pl.associated_people = (pl.associated_people as string[]).map(name =>
          buildWholeWordRegex(oldName).test(name)
            ? replaceInString(name, oldName, newName)
            : name
        );
      }

      if (typeof pl.narrative === 'string') {
        pl.narrative = replaceInString(pl.narrative, oldName, newName);
      }

      if (typeof pl.why_mentioned === 'string') {
        pl.why_mentioned = replaceInString(pl.why_mentioned, oldName, newName);
      }

      return pl;
    });
  }

  // Update relationships: person_a, person_b, evidence
  if (Array.isArray(updated.relationships)) {
    updated.relationships = (updated.relationships as Record<string, unknown>[]).map(rel => {
      const r = { ...rel };

      if (typeof r.person_a === 'string' && buildWholeWordRegex(oldName).test(r.person_a)) {
        r.person_a = replaceInString(r.person_a, oldName, newName);
      }
      if (typeof r.person_b === 'string' && buildWholeWordRegex(oldName).test(r.person_b)) {
        r.person_b = replaceInString(r.person_b, oldName, newName);
      }
      if (typeof r.evidence === 'string') {
        r.evidence = replaceInString(r.evidence, oldName, newName);
      }

      return r;
    });
  }

  // Update person_place_connections: person_name, evidence
  if (Array.isArray(updated.person_place_connections)) {
    updated.person_place_connections = (updated.person_place_connections as Record<string, unknown>[]).map(conn => {
      const c = { ...conn };

      if (typeof c.person_name === 'string' && buildWholeWordRegex(oldName).test(c.person_name)) {
        c.person_name = replaceInString(c.person_name, oldName, newName);
      }
      if (typeof c.evidence === 'string') {
        c.evidence = replaceInString(c.evidence, oldName, newName);
      }

      return c;
    });
  }

  return updated;
}

/**
 * Propagate a name change through all metadata fields for a letter.
 *
 * This is the "no AI" path — used when an old name exists and is being
 * replaced with a new name. Simple find-replace with whole-word matching.
 */
export async function propagateName(params: PropagateNameParams): Promise<PropagateNameResult> {
  const { letterId, field, oldName, newName } = params;
  const letterLog = log.child({ letterId, field, oldName, newName });

  letterLog.info('Starting name propagation');

  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  const fieldsUpdated: string[] = [];
  const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };

  // 1. Update top-level sender/recipient field
  dbUpdates[field] = newName;
  fieldsUpdated.push(field);

  // 2. Update summary
  if (letter.summary) {
    const updated = replaceInString(letter.summary, oldName, newName);
    if (updated !== letter.summary) {
      dbUpdates.summary = updated;
      fieldsUpdated.push('summary');
    }
  }

  // 3. Update hook (first name only)
  if (letter.hook) {
    const updated = replaceInHook(letter.hook, oldName, newName);
    if (updated !== letter.hook) {
      dbUpdates.hook = updated;
      fieldsUpdated.push('hook');
    }
  }

  // 4. Update metadataV2Json
  if (letter.metadataV2Json && typeof letter.metadataV2Json === 'object') {
    const updatedMetadata = propagateInMetadataV2(
      letter.metadataV2Json as Record<string, unknown>,
      field,
      oldName,
      newName,
    );
    dbUpdates.metadataV2Json = updatedMetadata;
    // Also keep legacy metadataJson in sync
    dbUpdates.metadataJson = updatedMetadata;
    fieldsUpdated.push('metadataV2Json');
  }

  // 5. Update entityExtractionJson
  if (letter.entityExtractionJson && typeof letter.entityExtractionJson === 'object') {
    const updatedEntities = propagateInEntityExtraction(
      letter.entityExtractionJson as Record<string, unknown>,
      oldName,
      newName,
    );
    dbUpdates.entityExtractionJson = updatedEntities;
    fieldsUpdated.push('entityExtractionJson');
  }

  // 6. Update aiNotes (structured jsonb array)
  if (letter.aiNotes && Array.isArray(letter.aiNotes)) {
    const updatedNotes = deepReplaceInValue(letter.aiNotes, oldName, newName);
    if (JSON.stringify(updatedNotes) !== JSON.stringify(letter.aiNotes)) {
      dbUpdates.aiNotes = updatedNotes;
      fieldsUpdated.push('aiNotes');
    }
  }

  await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

  letterLog.info({ fieldsUpdated }, 'Name propagation completed');

  // Re-fetch to return the updated letter
  const updatedLetter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  return {
    letter: updatedLetter!,
    fieldsUpdated,
  };
}

// ============================================================================
// PLACEHOLDER REPLACEMENT
// ============================================================================

export interface PlaceholderReplacementParams {
  letterId: string;
  field: 'sender' | 'recipient';
  newName: string;
}

export interface PlaceholderReplacementResult {
  letter: Letter;
  fieldsUpdated: string[];
}

/**
 * Deep-replace a placeholder (and "the sender"/"the recipient" phrases)
 * throughout a JSON-like object using the replacePlaceholder utility.
 */
function deepReplacePlaceholder(value: unknown, placeholder: string, replacement: string): unknown {
  if (typeof value === 'string') {
    return replacePlaceholder(value, placeholder, replacement);
  }
  if (Array.isArray(value)) {
    return value.map(item => deepReplacePlaceholder(item, placeholder, replacement));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepReplacePlaceholder(val, placeholder, replacement);
    }
    return result;
  }
  return value;
}

/**
 * Flip isPlaceholder to false on the matching entity in entityExtractionJson.
 * Matches by role ('sender' or 'recipient').
 */
function clearPlaceholderFlag(
  entities: Record<string, unknown>,
  field: 'sender' | 'recipient',
): Record<string, unknown> {
  const updated = { ...entities };

  if (Array.isArray(updated.people)) {
    updated.people = (updated.people as Record<string, unknown>[]).map(person => {
      if (person.role === field && person.isPlaceholder === true) {
        return { ...person, isPlaceholder: false };
      }
      return person;
    });
  }

  return updated;
}

/**
 * Replace placeholder tokens throughout all metadata fields for a letter.
 *
 * Used when the old sender/recipient value is a guillemet placeholder
 * (e.g. «SENDER» or «RECIPIENT») or was null. Replaces the placeholder
 * token AND "the sender"/"the recipient" prose phrases everywhere.
 *
 * No AI calls — purely deterministic string replacement.
 */
export async function propagatePlaceholderReplacement(
  params: PlaceholderReplacementParams,
): Promise<PlaceholderReplacementResult> {
  const { letterId, field, newName } = params;
  const placeholder = field === 'sender' ? PLACEHOLDERS.SENDER : PLACEHOLDERS.RECIPIENT;
  const letterLog = log.child({ letterId, field, newName, placeholder });

  letterLog.info('Starting placeholder replacement');

  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) {
    throw new Error(`Letter not found: ${letterId}`);
  }

  const fieldsUpdated: string[] = [];
  const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };

  // 1. Update top-level sender/recipient field
  dbUpdates[field] = newName;
  fieldsUpdated.push(field);

  // 2. Update summary
  if (letter.summary) {
    const updated = replacePlaceholder(letter.summary, placeholder, newName);
    if (updated !== letter.summary) {
      dbUpdates.summary = updated;
      fieldsUpdated.push('summary');
    }
  }

  // 3. Update hook (use first name for brevity)
  if (letter.hook) {
    const firstName = getFirstName(newName);
    let updated = replacePlaceholder(letter.hook, placeholder, firstName);
    // Also replace full phrases with first name in hooks
    if (field === 'sender') {
      updated = updated.replace(/\bthe sender's\b/gi, `${firstName}'s`);
      updated = updated.replace(/\bthe sender\b/gi, firstName);
    } else {
      updated = updated.replace(/\bthe recipient's\b/gi, `${firstName}'s`);
      updated = updated.replace(/\bthe recipient\b/gi, firstName);
    }
    if (updated !== letter.hook) {
      dbUpdates.hook = updated;
      fieldsUpdated.push('hook');
    }
  }

  // 4. Update metadataV2Json (deep traverse)
  if (letter.metadataV2Json && typeof letter.metadataV2Json === 'object') {
    const updatedMetadata = deepReplacePlaceholder(
      letter.metadataV2Json,
      placeholder,
      newName,
    ) as Record<string, unknown>;

    // Also update hook within metadataV2Json with first name
    if (typeof updatedMetadata.hook === 'string') {
      const firstName = getFirstName(newName);
      updatedMetadata.hook = replaceInHook(updatedMetadata.hook, newName, firstName);
    }

    dbUpdates.metadataV2Json = updatedMetadata;
    dbUpdates.metadataJson = updatedMetadata;
    fieldsUpdated.push('metadataV2Json');
  }

  // 5. Update entityExtractionJson (deep traverse + clear isPlaceholder flag)
  if (letter.entityExtractionJson && typeof letter.entityExtractionJson === 'object') {
    let updatedEntities = deepReplacePlaceholder(
      letter.entityExtractionJson,
      placeholder,
      newName,
    ) as Record<string, unknown>;

    updatedEntities = clearPlaceholderFlag(updatedEntities, field);

    dbUpdates.entityExtractionJson = updatedEntities;
    fieldsUpdated.push('entityExtractionJson');
  }

  // 6. Update aiNotes (structured jsonb array)
  if (letter.aiNotes && Array.isArray(letter.aiNotes)) {
    const updatedNotes = deepReplacePlaceholder(letter.aiNotes, placeholder, newName);
    if (JSON.stringify(updatedNotes) !== JSON.stringify(letter.aiNotes)) {
      dbUpdates.aiNotes = updatedNotes;
      fieldsUpdated.push('aiNotes');
    }
  }

  await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

  // Check for orphaned placeholders
  const allText = [
    dbUpdates.summary,
    dbUpdates.hook,
    dbUpdates.aiNotes ? JSON.stringify(dbUpdates.aiNotes) : null,
    dbUpdates.metadataV2Json ? JSON.stringify(dbUpdates.metadataV2Json) : null,
    dbUpdates.entityExtractionJson ? JSON.stringify(dbUpdates.entityExtractionJson) : null,
  ]
    .filter((t): t is string => typeof t === 'string')
    .join(' ');

  const orphaned = findOrphanedPlaceholders(allText);
  if (orphaned.length > 0) {
    letterLog.warn({ orphaned }, 'Orphaned placeholders remain after replacement');
  }

  letterLog.info({ fieldsUpdated }, 'Placeholder replacement completed');

  const updatedLetter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  return {
    letter: updatedLetter!,
    fieldsUpdated,
  };
}
