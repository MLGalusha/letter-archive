/**
 * Name Propagation Service
 *
 * When a human reviewer changes a sender/recipient name, this service
 * propagates the change through the editable metadata prose fields
 * (hook, summary, notes, quote contexts, metadataV2Json, entityExtractionJson)
 * while preserving verbatim quote text.
 *
 * No AI calls — purely deterministic string replacement.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db, letters, type Letter } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { PLACEHOLDERS, replacePlaceholder, findOrphanedPlaceholders, isPlaceholderValue } from '../utils/placeholders.js';
import {
  buildHumanMetadataJobPatch,
  observedMetadataRevisionConditions,
} from './letter/metadata-job.js';
import { buildMetadataDocumentProjectionPatch } from './letter/metadata-projection.js';

const log = createLogger({ module: 'name-propagation' });

export function identityRevisionConflict(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 409 });
}

export function isIdentityRevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = 'status' in error ? error.status : undefined;
  const statusCode = 'statusCode' in error ? error.statusCode : undefined;
  return status === 409 || statusCode === 409;
}

export interface PropagateNameParams {
  letterId: string;
  field: 'sender' | 'recipient';
  oldName: string;
  newName: string;
  observed: ObservedIdentityField;
}

export interface PropagateNameResult {
  letter: Letter;
  fieldsUpdated: string[];
}

export type IdentityField = 'sender' | 'recipient';

export interface IdentityStateSource {
  sender: string | null;
  recipient: string | null;
  metadataRevision: number;
  updatedAt: Date;
  metadataV2Json?: unknown;
  metadataJson?: unknown;
}

export type IdentityState = IdentityStateSource & { id: string };

/** The exact identity value and metadata revision a caller based its edit on. */
export interface ObservedIdentityField {
  value: string | null;
  metadataRevision: number;
  updatedAt: Date;
}

export function observeIdentityField(
  source: IdentityStateSource,
  field: IdentityField,
): ObservedIdentityField {
  return {
    value: source[field],
    metadataRevision: source.metadataRevision,
    updatedAt: source.updatedAt,
  };
}

/** Guard both the lifecycle revision and the specific identity value being changed. */
export function observedIdentityFieldConditions(
  letterId: string,
  field: IdentityField,
  observed: ObservedIdentityField,
) {
  return [
    ...observedMetadataRevisionConditions(letterId, observed),
    observed.value === null
      ? isNull(letters[field])
      : eq(letters[field], observed.value),
  ];
}

/** Commit the non-propagating identity path through the same exact CAS contract. */
export async function commitDirectIdentityField(input: {
  letter: IdentityState;
  field: IdentityField;
  value: string | null;
}): Promise<IdentityState> {
  const observed = observeIdentityField(input.letter, input.field);
  const committed = await db
    .update(letters)
    .set({
      [input.field]: input.value,
      ...buildMetadataDocumentProjectionPatch(input.letter, {
        [input.field]: input.value,
      }),
      ...buildHumanMetadataJobPatch(),
      updatedAt: new Date(),
    })
    .where(and(...observedIdentityFieldConditions(input.letter.id, input.field, observed)))
    .returning({
      id: letters.id,
      sender: letters.sender,
      recipient: letters.recipient,
      metadataRevision: letters.metadataRevision,
      updatedAt: letters.updatedAt,
      metadataV2Json: letters.metadataV2Json,
      metadataJson: letters.metadataJson,
    });

  if (committed.length === 0) {
    throw identityRevisionConflict(
      'Metadata changed during the identity update; reload and try again',
    );
  }
  return committed[0];
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

// ============================================================================
// NAME COMPONENT PARSING & VARIANT GENERATION
// ============================================================================

const HONORIFICS = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'DR', 'REV', 'SGT', 'PVT', 'CPL', 'LT', 'CAPT',
  'COL', 'MAJ', 'GEN', 'PROF', 'HON', 'SIR', 'DAME', 'FATHER', 'SISTER', 'BROTHER',
]);

const SUFFIXES = new Set([
  'JR', 'JUNIOR', 'SR', 'SENIOR', 'II', 'III', 'IV', 'V', 'ESQ',
]);

export interface NameComponents {
  honorific: string | null;
  firstName: string;
  middleParts: string[];
  lastName: string;
  suffix: string | null;
}

export interface NameVariant {
  pattern: string;
  replacementMode: 'full' | 'firstName';
}

/**
 * Parse a full name string into structured components.
 * Recognizes honorifics (MR, DR, etc.), suffixes (JR, III, etc.),
 * and splits the core name into first, middle, and last parts.
 */
export function parseNameComponents(fullName: string): NameComponents {
  const tokens = fullName.trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && !tokens[0])) {
    return { honorific: null, firstName: fullName.trim(), middleParts: [], lastName: fullName.trim(), suffix: null };
  }

  let honorific: string | null = null;
  let suffix: string | null = null;

  // Check first token for honorific
  const firstNorm = tokens[0].replace(/\.$/g, '').toUpperCase();
  if (HONORIFICS.has(firstNorm) && tokens.length > 1) {
    honorific = tokens.shift()!;
  }

  // Check last token for suffix
  if (tokens.length > 1) {
    const lastNorm = tokens[tokens.length - 1].replace(/\.$/g, '').toUpperCase();
    if (SUFFIXES.has(lastNorm)) {
      suffix = tokens.pop()!;
    }
  }

  // Remaining tokens: first, middles..., last
  if (tokens.length === 0) {
    return { honorific, firstName: fullName.trim(), middleParts: [], lastName: fullName.trim(), suffix };
  }

  const firstName = tokens[0];
  if (tokens.length === 1) {
    return { honorific, firstName, middleParts: [], lastName: firstName, suffix };
  }

  const lastName = tokens[tokens.length - 1];
  const middleParts = tokens.slice(1, -1);

  return { honorific, firstName, middleParts, lastName, suffix };
}

/**
 * Generate name variants from parsed components, ordered longest first.
 * Each variant has a pattern to match and a replacement mode (full name or first name only).
 * Deduplicates and filters variants shorter than 3 characters.
 */
export function generateNameVariants(components: NameComponents, originalName: string): NameVariant[] {
  const { honorific, firstName, middleParts, lastName, suffix } = components;
  const seen = new Set<string>();
  const variants: NameVariant[] = [];

  function add(parts: string[], mode: 'full' | 'firstName') {
    const pattern = parts.filter(Boolean).join(' ');
    if (pattern.length < 3) return;
    const key = pattern.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ pattern, replacementMode: mode });
  }

  const h = honorific ?? '';
  const m = middleParts.join(' ');
  const s = suffix ?? '';

  // 1. Full original name
  add([originalName], 'full');

  // 2. Without honorific
  if (honorific) {
    add([firstName, m, lastName, s].filter(Boolean), 'full');
  }

  // 3. Without suffix
  if (suffix) {
    add([h, firstName, m, lastName].filter(Boolean), 'full');
  }

  // 4. Without honorific AND suffix
  if (honorific && suffix) {
    add([firstName, m, lastName].filter(Boolean), 'full');
  }

  // 5. Without middle parts
  if (middleParts.length > 0) {
    add([h, firstName, lastName, s].filter(Boolean), 'full');
    add([firstName, lastName, s].filter(Boolean), 'full');
    add([h, firstName, lastName].filter(Boolean), 'full');
    add([firstName, lastName].filter(Boolean), 'full');
  }

  // 6. Honorific + last name
  if (honorific && firstName !== lastName) {
    add([honorific, lastName], 'full');
  }

  // 7. First name only (if different from full name and from lastName)
  if (firstName !== lastName && firstName.toLowerCase() !== originalName.toLowerCase()) {
    add([firstName], 'firstName');
  }

  // Sort by pattern length descending (longest first to prevent double-replacement)
  variants.sort((a, b) => b.pattern.length - a.pattern.length);

  return variants;
}

/**
 * Collect first names and aliases from OTHER people in the entity extraction JSON.
 * Used to prevent false-positive replacement of short name variants.
 */
export function getOtherPeopleFirstNames(
  entityJson: Record<string, unknown> | null | undefined,
  oldName: string,
  field: 'sender' | 'recipient',
): Set<string> {
  const names = new Set<string>();
  if (!entityJson || !Array.isArray(entityJson.people)) return names;

  const oldNameLower = oldName.toLowerCase();

  for (const person of entityJson.people as Record<string, unknown>[]) {
    const personName = typeof person.name === 'string' ? person.name : '';
    // Skip the target person (matched by role or name)
    if (person.role === field || personName.toLowerCase() === oldNameLower) {
      continue;
    }
    // Add first name
    if (personName) {
      const first = getFirstName(personName);
      if (first.length >= 3) names.add(first.toLowerCase());
    }
    // Add aliases
    if (Array.isArray(person.aliases)) {
      for (const alias of person.aliases as string[]) {
        if (typeof alias === 'string' && alias.length >= 3) {
          names.add(alias.toLowerCase());
          const aliasFirst = getFirstName(alias);
          if (aliasFirst.length >= 3) names.add(aliasFirst.toLowerCase());
        }
      }
    }
  }

  return names;
}

/**
 * Apply name variants to a string, longest first.
 * Skips single-word variants that collide with other people's names.
 */
function applyVariantsToString(
  text: string,
  variants: NameVariant[],
  newName: string,
  collisionNames: Set<string>,
): string {
  let result = text;
  const newFirstName = getFirstName(newName);

  for (const variant of variants) {
    // Skip single-word variants that collide with other people
    if (!variant.pattern.includes(' ') && collisionNames.has(variant.pattern.toLowerCase())) {
      continue;
    }
    const replacement = variant.replacementMode === 'firstName' ? newFirstName : newName;
    result = replaceInString(result, variant.pattern, replacement);
  }

  return result;
}

/**
 * Apply name variants to hook text. Always uses first-name replacement for brevity.
 */
function applyVariantsToHook(
  text: string,
  variants: NameVariant[],
  newName: string,
  collisionNames: Set<string>,
): string {
  let result = text;
  const newFirstName = getFirstName(newName);

  for (const variant of variants) {
    if (!variant.pattern.includes(' ') && collisionNames.has(variant.pattern.toLowerCase())) {
      continue;
    }
    result = replaceInString(result, variant.pattern, newFirstName);
  }

  return result;
}

type JsonPath = Array<string | number>;

function isHookPath(path: JsonPath): boolean {
  return path.length === 1 && path[0] === 'hook';
}

function shouldSkipMetadataStringPath(path: JsonPath): boolean {
  const topLevel = path[0];

  if (
    topLevel === 'sender'
    || topLevel === 'recipient'
    || topLevel === 'location_written'
    || topLevel === 'extracted_date'
    || topLevel === 'emotional_tone'
    || topLevel === 'sender_recipient_relationship'
    || topLevel === 'primary_topics'
  ) {
    return true;
  }

  if (path.length === 3 && path[0] === 'notable_quotes' && path[2] === 'text') {
    return true;
  }

  if (path.length === 3 && path[0] === 'notable_quotes' && path[2] === 'position') {
    return true;
  }

  if (
    path.length === 3
    && path[0] === 'ai_notes'
    && (path[2] === 'category' || path[2] === 'priority' || path[2] === 'resolves_when')
  ) {
    return true;
  }

  return false;
}

function replaceRolePhrases(
  text: string,
  field: 'sender' | 'recipient',
  replacement: string,
): string {
  if (field === 'sender') {
    return text
      .replace(/\bthe sender's\b/gi, `${replacement}'s`)
      .replace(/\bthe sender\b/gi, replacement);
  }

  return text
    .replace(/\bthe recipient's\b/gi, `${replacement}'s`)
    .replace(/\bthe recipient\b/gi, replacement);
}

function transformMetadataTextFields(
  value: unknown,
  transform: (text: string, path: JsonPath) => string,
  path: JsonPath = [],
): unknown {
  if (typeof value === 'string') {
    if (shouldSkipMetadataStringPath(path)) {
      return value;
    }
    return transform(value, path);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => transformMetadataTextFields(item, transform, [...path, index]));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = transformMetadataTextFields(val, transform, [...path, key]);
    }
    return result;
  }

  return value;
}

/**
 * Deep-apply name variants throughout a JSON-like object.
 */
export function deepApplyVariants(
  value: unknown,
  variants: NameVariant[],
  newName: string,
  collisionNames: Set<string>,
): unknown {
  if (typeof value === 'string') {
    return applyVariantsToString(value, variants, newName, collisionNames);
  }
  if (Array.isArray(value)) {
    return value.map(item => deepApplyVariants(item, variants, newName, collisionNames));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = deepApplyVariants(val, variants, newName, collisionNames);
    }
    return result;
  }
  return value;
}

/**
 * Update metadataV2Json with the new name using variant-based replacement.
 */
export function propagateInMetadataV2(
  metadata: Record<string, unknown>,
  field: 'sender' | 'recipient',
  variants: NameVariant[],
  newName: string,
  collisionNames: Set<string>,
): Record<string, unknown> {
  const updated = { ...metadata, [field]: newName };
  const newFirstName = getFirstName(newName);

  return transformMetadataTextFields(updated, (text, path) => {
    const replacement = isHookPath(path) ? newFirstName : newName;
    const renamed = isHookPath(path)
      ? applyVariantsToHook(text, variants, newName, collisionNames)
      : applyVariantsToString(text, variants, newName, collisionNames);

    return replaceRolePhrases(renamed, field, replacement);
  }) as Record<string, unknown>;
}

/**
 * Check if a person entry is the target being renamed (by role or name match).
 */
function isTargetPerson(
  person: Record<string, unknown>,
  oldName: string,
  field: 'sender' | 'recipient',
): boolean {
  if (person.role === field) return true;
  if (typeof person.name === 'string' && person.name.toLowerCase() === oldName.toLowerCase()) return true;
  return false;
}

/**
 * Update entityExtractionJson with the new name using variant-based replacement.
 *
 * Target person's entry: apply ALL variants (safe since we know it's the right person),
 * and preserve the old name in their aliases array.
 *
 * Other entries: only apply multi-word variants; skip single-word to avoid false positives.
 */
export function propagateInEntityExtraction(
  entities: Record<string, unknown>,
  oldName: string,
  newName: string,
  field: 'sender' | 'recipient',
  variants: NameVariant[],
  collisionNames: Set<string>,
): Record<string, unknown> {
  const updated = { ...entities };
  const noCollision = new Set<string>(); // empty set = no collision filtering for target person
  const multiWordVariants = variants.filter(v => v.pattern.includes(' '));

  // Update people array
  if (Array.isArray(updated.people)) {
    updated.people = (updated.people as Record<string, unknown>[]).map(person => {
      const p = { ...person };
      const isTarget = isTargetPerson(p, oldName, field);
      // Target person: use all variants, no collision filtering
      // Other people: use only multi-word variants with collision filtering
      const effectiveVariants = isTarget ? variants : multiWordVariants;
      const effectiveCollisions = isTarget ? noCollision : collisionNames;

      // Update person name
      if (typeof p.name === 'string') {
        p.name = applyVariantsToString(p.name, effectiveVariants, newName, effectiveCollisions);
      }

      // Preserve old name in target person's aliases
      if (isTarget && Array.isArray(p.aliases)) {
        const existingAliases = p.aliases as string[];
        const hasOldName = existingAliases.some(a =>
          typeof a === 'string' && a.toLowerCase() === oldName.toLowerCase()
        );
        if (!hasOldName) {
          p.aliases = [...existingAliases, oldName];
        }
        // Replace other alias values that match variants
        p.aliases = (p.aliases as string[]).map(alias => {
          if (typeof alias === 'string' && alias.toLowerCase() === oldName.toLowerCase()) return alias; // keep the preserved old name
          return applyVariantsToString(alias, effectiveVariants, newName, effectiveCollisions);
        });
      } else if (Array.isArray(p.aliases)) {
        p.aliases = (p.aliases as string[]).map(alias =>
          typeof alias === 'string'
            ? applyVariantsToString(alias, effectiveVariants, newName, effectiveCollisions)
            : alias
        );
      }

      // Update text fields
      if (typeof p.relationship_to_sender === 'string') {
        p.relationship_to_sender = applyVariantsToString(p.relationship_to_sender, effectiveVariants, newName, effectiveCollisions);
      }
      if (typeof p.narrative === 'string') {
        p.narrative = applyVariantsToString(p.narrative, effectiveVariants, newName, effectiveCollisions);
        // Add name-change context for the target person's narrative
        if (isTarget && oldName.toLowerCase() !== newName.toLowerCase()) {
          p.narrative = `${p.narrative} (Originally identified as ${oldName}.)`;
        }
      }
      if (typeof p.emotional_significance === 'string') {
        p.emotional_significance = applyVariantsToString(p.emotional_significance, effectiveVariants, newName, effectiveCollisions);
      }

      // Update quotes contexts
      if (Array.isArray(p.quotes)) {
        p.quotes = (p.quotes as Record<string, unknown>[]).map(quote => ({
          ...quote,
          context: typeof quote.context === 'string'
            ? applyVariantsToString(quote.context, effectiveVariants, newName, effectiveCollisions)
            : quote.context,
        }));
      }

      // Update details
      if (Array.isArray(p.details)) {
        p.details = (p.details as Record<string, unknown>[]).map(detail => ({
          ...detail,
          detail: typeof detail.detail === 'string'
            ? applyVariantsToString(detail.detail, effectiveVariants, newName, effectiveCollisions)
            : detail.detail,
        }));
      }

      return p;
    });
  }

  // Update places: use multi-word variants + collision filtering
  if (Array.isArray(updated.places)) {
    updated.places = (updated.places as Record<string, unknown>[]).map(place => {
      const pl = { ...place };

      if (Array.isArray(pl.associated_people)) {
        pl.associated_people = (pl.associated_people as string[]).map(name =>
          typeof name === 'string'
            ? applyVariantsToString(name, variants, newName, collisionNames)
            : name
        );
      }

      if (typeof pl.narrative === 'string') {
        pl.narrative = applyVariantsToString(pl.narrative, variants, newName, collisionNames);
      }

      if (typeof pl.why_mentioned === 'string') {
        pl.why_mentioned = applyVariantsToString(pl.why_mentioned, variants, newName, collisionNames);
      }

      return pl;
    });
  }

  // Update relationships
  if (Array.isArray(updated.relationships)) {
    updated.relationships = (updated.relationships as Record<string, unknown>[]).map(rel => {
      const r = { ...rel };

      if (typeof r.person_a === 'string') {
        r.person_a = applyVariantsToString(r.person_a, variants, newName, collisionNames);
      }
      if (typeof r.person_b === 'string') {
        r.person_b = applyVariantsToString(r.person_b, variants, newName, collisionNames);
      }
      if (typeof r.evidence === 'string') {
        r.evidence = applyVariantsToString(r.evidence, variants, newName, collisionNames);
      }

      return r;
    });
  }

  // Update person_place_connections
  if (Array.isArray(updated.person_place_connections)) {
    updated.person_place_connections = (updated.person_place_connections as Record<string, unknown>[]).map(conn => {
      const c = { ...conn };

      if (typeof c.person_name === 'string') {
        c.person_name = applyVariantsToString(c.person_name, variants, newName, collisionNames);
      }
      if (typeof c.evidence === 'string') {
        c.evidence = applyVariantsToString(c.evidence, variants, newName, collisionNames);
      }

      return c;
    });
  }

  return updated;
}

/**
 * Propagate a name change through all metadata fields for a letter.
 *
 * Parses the old name into components and generates variants (e.g., with/without
 * honorific, suffix, middle parts) to catch shortened forms the AI may have used.
 * Applies replacements longest-first to prevent double-replacement.
 * Skips single-word variants that collide with other people's first names.
 */
export async function propagateName(params: PropagateNameParams): Promise<PropagateNameResult> {
  const { letterId, field, oldName, newName, observed } = params;
  const letterLog = log.child({ letterId, field, oldName, newName });

  letterLog.info('Starting name propagation');

  if (observed.value !== oldName) {
    throw identityRevisionConflict(
      'The expected identity no longer matches the observed value; reload and try again',
    );
  }

  const letter = await db.query.letters.findFirst({
    where: and(...observedIdentityFieldConditions(letterId, field, observed)),
  });

  if (!letter) {
    throw identityRevisionConflict(
      'Metadata changed before name propagation began; reload and try again',
    );
  }

  if (oldName === newName) {
    return { letter, fieldsUpdated: [] };
  }

  // Parse old name and generate variants
  const components = parseNameComponents(oldName);
  const variants = generateNameVariants(components, oldName);
  const entityJson = letter.entityExtractionJson as Record<string, unknown> | null;
  const collisionNames = getOtherPeopleFirstNames(entityJson, oldName, field);

  letterLog.info({ variants: variants.map(v => v.pattern), collisionNames: [...collisionNames] }, 'Generated name variants');

  const fieldsUpdated: string[] = [];
  const dbUpdates: Record<string, unknown> = {
    ...buildHumanMetadataJobPatch(),
    updatedAt: new Date(),
  };

  // 1. Update top-level sender/recipient field
  dbUpdates[field] = newName;
  fieldsUpdated.push(field);

  // 2. Update summary (also replace stray "the sender"/"the recipient" phrases)
  if (letter.summary) {
    let updated = applyVariantsToString(letter.summary, variants, newName, collisionNames);
    if (field === 'sender') {
      updated = updated.replace(/\bthe sender's\b/gi, `${newName}'s`);
      updated = updated.replace(/\bthe sender\b/gi, newName);
    } else {
      updated = updated.replace(/\bthe recipient's\b/gi, `${newName}'s`);
      updated = updated.replace(/\bthe recipient\b/gi, newName);
    }
    if (updated !== letter.summary) {
      dbUpdates.summary = updated;
      fieldsUpdated.push('summary');
    }
  }

  // 3. Update hook (first name only; also replace stray "the sender"/"the recipient" phrases)
  if (letter.hook) {
    const newFirstName = getFirstName(newName);
    let updated = applyVariantsToHook(letter.hook, variants, newName, collisionNames);
    if (field === 'sender') {
      updated = updated.replace(/\bthe sender's\b/gi, `${newFirstName}'s`);
      updated = updated.replace(/\bthe sender\b/gi, newFirstName);
    } else {
      updated = updated.replace(/\bthe recipient's\b/gi, `${newFirstName}'s`);
      updated = updated.replace(/\bthe recipient\b/gi, newFirstName);
    }
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
      variants,
      newName,
      collisionNames,
    );
    dbUpdates.metadataV2Json = updatedMetadata;
    dbUpdates.metadataJson = updatedMetadata;
    fieldsUpdated.push('metadataV2Json');
  } else if (letter.metadataJson && typeof letter.metadataJson === 'object') {
    const updatedMetadata = propagateInMetadataV2(
      letter.metadataJson as Record<string, unknown>,
      field,
      variants,
      newName,
      collisionNames,
    );
    dbUpdates.metadataJson = updatedMetadata;
    fieldsUpdated.push('metadataJson');
  }

  // 5. Update entityExtractionJson (with scoped replacement + alias preservation)
  if (entityJson && typeof entityJson === 'object') {
    const updatedEntities = propagateInEntityExtraction(
      entityJson,
      oldName,
      newName,
      field,
      variants,
      collisionNames,
    );
    dbUpdates.entityExtractionJson = updatedEntities;
    fieldsUpdated.push('entityExtractionJson');
  }

  // 6. Update aiNotes (structured jsonb array)
  if (letter.aiNotes && Array.isArray(letter.aiNotes)) {
    const updatedNotes = deepApplyVariants(letter.aiNotes, variants, newName, collisionNames);
    if (JSON.stringify(updatedNotes) !== JSON.stringify(letter.aiNotes)) {
      dbUpdates.aiNotes = updatedNotes;
      fieldsUpdated.push('aiNotes');
    }
  }

  const propagated = await db
    .update(letters)
    .set(dbUpdates)
    .where(and(...observedIdentityFieldConditions(letterId, field, observed)))
    .returning();
  if (propagated.length === 0) {
    throw identityRevisionConflict(
      'Metadata changed during name propagation; reload and try again',
    );
  }

  letterLog.info({ fieldsUpdated }, 'Name propagation completed');

  return {
    letter: propagated[0],
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
  observed: ObservedIdentityField;
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
  const { letterId, field, newName, observed } = params;
  const placeholder = field === 'sender' ? PLACEHOLDERS.SENDER : PLACEHOLDERS.RECIPIENT;
  const letterLog = log.child({ letterId, field, newName, placeholder });

  letterLog.info('Starting placeholder replacement');

  const letter = await db.query.letters.findFirst({
    where: and(...observedIdentityFieldConditions(letterId, field, observed)),
  });

  if (!letter) {
    throw identityRevisionConflict(
      'Metadata changed before placeholder replacement began; reload and try again',
    );
  }

  if (observed.value === newName) {
    return { letter, fieldsUpdated: [] };
  }

  const fieldsUpdated: string[] = [];
  const dbUpdates: Record<string, unknown> = {
    ...buildHumanMetadataJobPatch(),
    updatedAt: new Date(),
  };

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
    const firstName = getFirstName(newName);
    const updatedMetadata = transformMetadataTextFields(
      {
        ...(letter.metadataV2Json as Record<string, unknown>),
        [field]: newName,
      },
      (text, path) => {
        const replacement = isHookPath(path) ? firstName : newName;
        const updatedText = replacePlaceholder(text, placeholder, replacement);
        return replaceRolePhrases(updatedText, field, replacement);
      },
    ) as Record<string, unknown>;

    dbUpdates.metadataV2Json = updatedMetadata;
    dbUpdates.metadataJson = updatedMetadata;
    fieldsUpdated.push('metadataV2Json');
  } else if (letter.metadataJson && typeof letter.metadataJson === 'object') {
    const firstName = getFirstName(newName);
    const updatedMetadata = transformMetadataTextFields(
      {
        ...(letter.metadataJson as Record<string, unknown>),
        [field]: newName,
      },
      (text, path) => {
        const replacement = isHookPath(path) ? firstName : newName;
        const updatedText = replacePlaceholder(text, placeholder, replacement);
        return replaceRolePhrases(updatedText, field, replacement);
      },
    ) as Record<string, unknown>;

    dbUpdates.metadataJson = updatedMetadata;
    fieldsUpdated.push('metadataJson');
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

  const propagated = await db
    .update(letters)
    .set(dbUpdates)
    .where(and(...observedIdentityFieldConditions(letterId, field, observed)))
    .returning();
  if (propagated.length === 0) {
    throw identityRevisionConflict(
      'Metadata changed during placeholder replacement; reload and try again',
    );
  }

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

  return {
    letter: propagated[0],
    fieldsUpdated,
  };
}
