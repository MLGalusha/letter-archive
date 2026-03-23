import type {
  CollectionLetterPersonJunction,
  CollectionPerson,
  CollectionRelationship,
  GenericPerson,
  LetterMissingParticipant,
} from '../../services/entities/collection-queries.js';

export const ENTITY_RESOLUTION_SYSTEM_PROMPT = `You are an expert genealogist performing cross-letter identity resolution on a collection of historical letters. You have been given ALL canonical persons, their letter appearances, and relationships for the entire collection.

<task>
Analyze all entities across the collection and produce a resolution plan:
1. MERGE GROUPS: Identify persons that are actually the same individual (nicknames, spelling variations, formal vs informal names)
2. GENERIC RESOLUTIONS: Resolve placeholder entities ("the sender", "your brother") to real identified persons, or mark for deletion
3. SENDER/RECIPIENT FILLS: For letters with missing sender or recipient fields, infer the correct person from junction data
4. RELATIONSHIP CORRECTIONS: Fix mistyped relationships or flag duplicates created by split entities
</task>

<merge_guidelines>
- Nickname to formal name mappings are common: "Jimmie" → "James", "Molly" → "Mary", "Geo." → "George"
- Shared correspondents are a strong signal: if "Jimmie" and "James A Hamler Jr" both appear as sender writing to the same recipient, they are likely the same person
- Same role patterns: if person A is always sender and person B is always sender with similar names, they may be the same
- Consider letter dates: entities appearing in overlapping time periods with similar contexts are stronger merge candidates
- Prefer the most complete/formal name as the canonical name
- The keep_person_id should be the one with more data (more letters, more relationships)
- Confidence tiers:
  - 0.95+: Obvious match (same name with minor spelling variation, clear nickname)
  - 0.85-0.94: Strong match (nickname + shared correspondents + consistent context)
  - 0.70-0.84: Probable match (similar name but less contextual evidence)
  - Below 0.70: Uncertain, include but expect human review
</merge_guidelines>

<generic_guidelines>
- Resolve "the sender" or "the writer" to the actual sender if unambiguous from letter context
- Resolve "your brother" to a named brother if the relationship is established elsewhere
- DELETE generic entities that add no information (e.g., "a man" with no identifying details)
- KEEP generic entities only if they refer to a genuinely unidentified person with meaningful context
- For merge: set resolves_to_person_id to the real person's ID
- For delete: set resolves_to_person_id to null
</generic_guidelines>

<fill_guidelines>
- Infer sender/recipient from junction data: if a person has role "sender" in the junction table but the letter's sender field is null, fill it
- Only fill when there is strong evidence (the junction exists with the right role)
- Use the canonical name for the fill
- Do NOT overwrite existing values
</fill_guidelines>

<relationship_guidelines>
- After merges, some relationships may become duplicates (A↔B and A↔C, where B and C are now merged)
- Flag relationships with incorrect types (e.g., two known siblings marked as "unknown")
- For corrections: provide the corrected_type from the allowed relationship types
- For deletions (duplicate relationships): set corrected_type to null
- Allowed relationship types: spouse, fiancé/fiancée, romantic-partner, parent-child, sibling, grandparent-grandchild, aunt-uncle-niece-nephew, cousin, in-law, friend, acquaintance, business-associate, employer-employee, unknown
</relationship_guidelines>

<confidence_thresholds>
Actions with confidence >= 0.85 will be auto-executed.
Actions with confidence < 0.85 will be queued for human review.
Set confidence accurately — overconfident merges destroy data.
</confidence_thresholds>

<verification>
Before returning, verify:
1. No person ID appears in both keep_person_id and merge_person_ids across different merge groups
2. All referenced person IDs exist in the provided data
3. All referenced letter IDs exist in the provided data
4. Merge groups don't create circular references
5. Generic resolutions point to valid person IDs (or null for deletions)
6. Relationship corrections reference valid relationship types
</verification>`;

export function buildEntityResolutionUserPrompt(data: {
  persons: CollectionPerson[];
  junctions: CollectionLetterPersonJunction[];
  relationships: CollectionRelationship[];
  missingParticipants: LetterMissingParticipant[];
  genericPersons: GenericPerson[];
}): string {
  let prompt = '';

  prompt += '<canonical_persons>\n';
  for (const p of data.persons) {
    const aliases = p.aliases.length > 0 ? ` aliases=[${p.aliases.join(', ')}]` : '';
    prompt += `- id=${p.id} name="${p.canonicalName}"${aliases} letters=${p.letterCount} sender=${p.senderCount} recipient=${p.recipientCount} mentioned=${p.mentionedCount}\n`;
  }
  prompt += '</canonical_persons>\n\n';

  prompt += '<letter_person_junctions>\n';
  const junctionsByLetter = new Map<string, CollectionLetterPersonJunction[]>();
  for (const j of data.junctions) {
    const existing = junctionsByLetter.get(j.letterId) || [];
    existing.push(j);
    junctionsByLetter.set(j.letterId, existing);
  }
  for (const [letterId, junctions] of junctionsByLetter) {
    const first = junctions[0];
    prompt += `\nLetter ${letterId} (${first.dateRaw}):\n`;
    if (first.summary) prompt += `  Summary: ${first.summary}\n`;
    for (const j of junctions) {
      const nameWritten = j.nameAsWritten ? ` nameAsWritten="${j.nameAsWritten}"` : '';
      const ctx = j.context ? ` context="${j.context}"` : '';
      prompt += `  - person=${j.personId} "${j.personName}" role=${j.role}${nameWritten}${ctx} confidence=${j.confidence}\n`;
    }
  }
  prompt += '</letter_person_junctions>\n\n';

  if (data.relationships.length > 0) {
    prompt += '<existing_relationships>\n';
    for (const r of data.relationships) {
      prompt += `- id=${r.id} "${r.personAName}" (${r.personAId}) ↔ "${r.personBName}" (${r.personBId}) type=${r.relationshipType} confidence=${r.confidence}\n`;
    }
    prompt += '</existing_relationships>\n\n';
  }

  if (data.missingParticipants.length > 0) {
    prompt += '<letters_missing_participants>\n';
    for (const l of data.missingParticipants) {
      const missing = [];
      if (l.missingSender) missing.push('sender');
      if (l.missingRecipient) missing.push('recipient');
      prompt += `- letter=${l.letterId} date=${l.dateRaw} missing=[${missing.join(', ')}]`;
      if (l.sender) prompt += ` sender="${l.sender}"`;
      if (l.recipient) prompt += ` recipient="${l.recipient}"`;
      if (l.summary) prompt += ` summary="${l.summary}"`;
      prompt += '\n';
    }
    prompt += '</letters_missing_participants>\n\n';
  }

  if (data.genericPersons.length > 0) {
    prompt += '<generic_entities>\n';
    for (const g of data.genericPersons) {
      prompt += `- id=${g.id} name="${g.canonicalName}" letters=${g.letterCount}\n`;
    }
    prompt += '</generic_entities>\n\n';
  }

  prompt += 'Analyze all entities and produce a resolution plan. Return JSON only.';

  return prompt;
}
