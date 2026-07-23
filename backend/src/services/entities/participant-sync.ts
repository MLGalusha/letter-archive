import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  db,
  canonicalPersons,
  letterPersons,
  letters,
  personRelationships,
  type Database,
  type PersonRelationshipType,
  type RelationshipType as MetadataRelationshipType,
} from '../../db/index.js';
import type { MatchResult } from './matching.js';
import { findMatchingPersons } from './matching.js';
import { addToReviewQueue } from './review-queue.js';

const STRICT_AUTO_LINK_SIMILARITY = 95;
const STRICT_AUTO_LINK_MIN_GAP = 8;

export type ParticipantSyncDatabase = Pick<
  Database,
  'delete' | 'execute' | 'insert' | 'query' | 'select' | 'update'
>;

export function buildHumanEntityProvenancePatch(actor: string, now: Date = new Date()) {
  return {
    entityExtractionRevision: null,
    confirmedBy: actor,
    confirmedAt: now,
  };
}

export function normalizeEntityName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const normalized = name.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

export interface ManualNameDecision {
  mode: 'auto-link' | 'create';
  selectedEntityId?: string;
  reason: 'no-match' | 'below-threshold' | 'ambiguous' | 'high-confidence';
  topSimilarity?: number;
}

export function decideManualNameAutoLink(
  matches: Array<Pick<MatchResult, 'entityId' | 'similarity'>>,
  minSimilarity: number = STRICT_AUTO_LINK_SIMILARITY,
  minGap: number = STRICT_AUTO_LINK_MIN_GAP,
): ManualNameDecision {
  if (matches.length === 0) {
    return { mode: 'create', reason: 'no-match' };
  }

  const [best, second] = matches;
  if (best.similarity < minSimilarity) {
    return {
      mode: 'create',
      reason: 'below-threshold',
      topSimilarity: best.similarity,
    };
  }

  if (second && best.similarity - second.similarity < minGap) {
    return {
      mode: 'create',
      reason: 'ambiguous',
      topSimilarity: best.similarity,
    };
  }

  return {
    mode: 'auto-link',
    selectedEntityId: best.entityId,
    reason: 'high-confidence',
    topSimilarity: best.similarity,
  };
}

interface ExactMatchRow extends Record<string, unknown> {
  id: string;
  canonical_name: string;
}

function getRows<T>(results: unknown): T[] {
  if (Array.isArray(results)) return results as T[];
  return ((results as { rows?: T[] }).rows ?? []) as T[];
}

async function findExactPersonMatchesByName(
  name: string,
  database: ParticipantSyncDatabase,
): Promise<Array<{ id: string; canonicalName: string }>> {
  const results = await database.execute<ExactMatchRow>(sql`
    SELECT id, canonical_name
    FROM canonical_persons
    WHERE lower(canonical_name) = lower(${name})
      OR EXISTS (
        SELECT 1
        FROM unnest(aliases) AS alias
        WHERE lower(alias) = lower(${name})
      )
    ORDER BY canonical_name ASC
  `);

  return getRows<ExactMatchRow>(results).map((row) => ({
    id: row.id,
    canonicalName: row.canonical_name,
  }));
}

interface ResolveParticipantResult {
  personId: string;
  confidence: number;
  created: boolean;
  resolution:
    | 'exact'
    | 'high-confidence-match'
    | 'new-person'
    | 'ambiguous-exact-created';
}

async function createCanonicalPersonForManualEntry(
  name: string,
  database: ParticipantSyncDatabase,
): Promise<string> {
  const [person] = await database
    .insert(canonicalPersons)
    .values({
      canonicalName: name,
      notes: 'Created from manual sender/recipient edit',
    })
    .returning({ id: canonicalPersons.id });
  return person.id;
}

async function resolveParticipantFromName(
  letterId: string,
  role: 'sender' | 'recipient',
  name: string,
  database: ParticipantSyncDatabase,
): Promise<ResolveParticipantResult> {
  const exactMatches = await findExactPersonMatchesByName(name, database);

  if (exactMatches.length === 1) {
    return {
      personId: exactMatches[0].id,
      confidence: 100,
      created: false,
      resolution: 'exact',
    };
  }

  if (exactMatches.length > 1) {
    const personId = await createCanonicalPersonForManualEntry(name, database);
    await addToReviewQueue({
      entityType: 'person',
      extractedText: name,
      letterId,
      suggestedEntityId: exactMatches[0].id,
      context: `Manual ${role} edit matched multiple existing people with the same name`,
      confidence: 100,
    }, database);
    return {
      personId,
      confidence: 100,
      created: true,
      resolution: 'ambiguous-exact-created',
    };
  }

  const fuzzyMatches = await findMatchingPersons(name, 3, database);
  const decision = decideManualNameAutoLink(fuzzyMatches);
  if (decision.mode === 'auto-link' && decision.selectedEntityId) {
    return {
      personId: decision.selectedEntityId,
      confidence: decision.topSimilarity ?? 95,
      created: false,
      resolution: 'high-confidence-match',
    };
  }

  const personId = await createCanonicalPersonForManualEntry(name, database);
  if (fuzzyMatches.length > 0 && fuzzyMatches[0].similarity >= 50) {
    await addToReviewQueue({
      entityType: 'person',
      extractedText: name,
      letterId,
      suggestedEntityId: fuzzyMatches[0].entityId,
      context: `Manual ${role} edit created a new person due to ambiguous fuzzy match`,
      confidence: fuzzyMatches[0].similarity,
    }, database);
  }

  return {
    personId,
    confidence: 100,
    created: true,
    resolution: 'new-person',
  };
}

async function clearRoleLinks(
  letterId: string,
  role: 'sender' | 'recipient',
  database: ParticipantSyncDatabase,
): Promise<number> {
  const existing = await database
    .select({ id: letterPersons.id })
    .from(letterPersons)
    .where(and(eq(letterPersons.letterId, letterId), eq(letterPersons.role, role)));

  if (existing.length === 0) return 0;

  await database
    .delete(letterPersons)
    .where(
      inArray(
        letterPersons.id,
        existing.map((item) => item.id),
      ),
    );
  return existing.length;
}

async function upsertRoleLink(input: {
  letterId: string;
  role: 'sender' | 'recipient';
  personId: string;
  nameAsWritten: string;
  confidence: number;
  actor: string;
  database: ParticipantSyncDatabase;
}): Promise<void> {
  const {
    letterId,
    role,
    personId,
    nameAsWritten,
    confidence,
    actor,
    database,
  } = input;
  const humanProvenance = buildHumanEntityProvenancePatch(actor);

  const roleLinks = await database.query.letterPersons.findMany({
    where: and(eq(letterPersons.letterId, letterId), eq(letterPersons.role, role)),
  });

  const selected = roleLinks.find((link) => link.personId === personId);

  if (!selected) {
    await database.insert(letterPersons).values({
      letterId,
      role,
      personId,
      nameAsWritten,
      confidence,
      ...humanProvenance,
    }).onConflictDoNothing();
  }

  await database.update(letterPersons).set({
    nameAsWritten,
    confidence,
    ...humanProvenance,
  }).where(
    and(
      eq(letterPersons.letterId, letterId),
      eq(letterPersons.role, role),
      eq(letterPersons.personId, personId),
    ),
  );

  const linksToDelete = roleLinks
    .filter((link) => link.personId !== personId)
    .map((link) => link.id);

  if (linksToDelete.length > 0) {
    await database.delete(letterPersons).where(inArray(letterPersons.id, linksToDelete));
  }
}

export function mapMetadataRelationshipToPersonRelationship(
  relationship: MetadataRelationshipType | null | undefined,
): PersonRelationshipType {
  switch (relationship) {
    case 'spouse':
      return 'spouse';
    case 'fiancé/fiancée':
      return 'fiancé/fiancée';
    case 'romantic-partner':
      return 'romantic-partner';
    case 'parent':
    case 'child':
      return 'parent-child';
    case 'sibling':
      return 'sibling';
    case 'grandparent':
    case 'grandchild':
      return 'grandparent-grandchild';
    case 'aunt/uncle':
    case 'nephew/niece':
      return 'aunt-uncle-niece-nephew';
    case 'cousin':
      return 'cousin';
    case 'in-law':
      return 'in-law';
    case 'friend':
      return 'friend';
    case 'acquaintance':
      return 'acquaintance';
    case 'business-associate':
      return 'business-associate';
    case 'employer':
    case 'employee':
      return 'employer-employee';
    case 'unknown':
    default:
      return 'unknown';
  }
}

export async function syncSenderRecipientRelationshipFromLetter(
  letterId: string,
  relationshipType: MetadataRelationshipType | null | undefined,
  actor: string = 'admin',
  database: ParticipantSyncDatabase = db,
): Promise<void> {
  const roleLinks = await database
    .select({
      role: letterPersons.role,
      personId: letterPersons.personId,
    })
    .from(letterPersons)
    .where(
      and(
        eq(letterPersons.letterId, letterId),
        inArray(letterPersons.role, ['sender', 'recipient']),
      ),
    );

  const sender = roleLinks.find((link) => link.role === 'sender')?.personId;
  const recipient = roleLinks.find((link) => link.role === 'recipient')?.personId;

  if (!sender || !recipient || sender === recipient) return;

  const [personAId, personBId] = [sender, recipient].sort();
  const mappedType = mapMetadataRelationshipToPersonRelationship(relationshipType);
  const now = new Date();
  const humanProvenance = buildHumanEntityProvenancePatch(actor, now);

  const existing = await database.query.personRelationships.findFirst({
    where: and(
      eq(personRelationships.personAId, personAId),
      eq(personRelationships.personBId, personBId),
    ),
  });

  if (!existing) {
    await database.insert(personRelationships).values({
      personAId,
      personBId,
      relationshipType: mappedType,
      discoveredInLetterId: letterId,
      confidence: 95,
      ...humanProvenance,
    });
    return;
  }

  if (mappedType === 'unknown') return;

  if (existing.relationshipType === 'unknown' || existing.discoveredInLetterId === letterId) {
    await database.update(personRelationships).set({
      relationshipType: mappedType,
      discoveredInLetterId: existing.discoveredInLetterId || letterId,
      confidence: Math.max(existing.confidence, 95),
      ...humanProvenance,
      updatedAt: now,
    }).where(eq(personRelationships.id, existing.id));
  }
}

export interface ParticipantSyncResult {
  sender: {
    action: 'unchanged' | 'cleared' | 'linked';
    personId?: string;
    created?: boolean;
    resolution?: ResolveParticipantResult['resolution'];
  };
  recipient: {
    action: 'unchanged' | 'cleared' | 'linked';
    personId?: string;
    created?: boolean;
    resolution?: ResolveParticipantResult['resolution'];
  };
}

export async function syncLetterParticipantsFromMetadata(input: {
  letterId: string;
  sender?: string | null;
  recipient?: string | null;
  relationshipType?: MetadataRelationshipType | null;
  actor?: string;
  database?: ParticipantSyncDatabase;
}): Promise<ParticipantSyncResult> {
  const { letterId, actor = 'admin', database = db } = input;
  const result: ParticipantSyncResult = {
    sender: { action: 'unchanged' },
    recipient: { action: 'unchanged' },
  };

  if (input.sender !== undefined) {
    const normalizedSender = normalizeEntityName(input.sender);
    if (!normalizedSender) {
      await clearRoleLinks(letterId, 'sender', database);
      result.sender = { action: 'cleared' };
    } else {
      const senderResolution = await resolveParticipantFromName(
        letterId,
        'sender',
        normalizedSender,
        database,
      );
      await upsertRoleLink({
        letterId,
        role: 'sender',
        personId: senderResolution.personId,
        nameAsWritten: normalizedSender,
        confidence: senderResolution.confidence,
        actor,
        database,
      });
      result.sender = {
        action: 'linked',
        personId: senderResolution.personId,
        created: senderResolution.created,
        resolution: senderResolution.resolution,
      };
    }
  }

  if (input.recipient !== undefined) {
    const normalizedRecipient = normalizeEntityName(input.recipient);
    if (!normalizedRecipient) {
      await clearRoleLinks(letterId, 'recipient', database);
      result.recipient = { action: 'cleared' };
    } else {
      const recipientResolution = await resolveParticipantFromName(
        letterId,
        'recipient',
        normalizedRecipient,
        database,
      );
      await upsertRoleLink({
        letterId,
        role: 'recipient',
        personId: recipientResolution.personId,
        nameAsWritten: normalizedRecipient,
        confidence: recipientResolution.confidence,
        actor,
        database,
      });
      result.recipient = {
        action: 'linked',
        personId: recipientResolution.personId,
        created: recipientResolution.created,
        resolution: recipientResolution.resolution,
      };
    }
  }

  if (
    input.sender !== undefined ||
    input.recipient !== undefined ||
    input.relationshipType !== undefined
  ) {
    const currentLetter = await database.query.letters.findFirst({
      where: eq(letters.id, letterId),
      columns: {
        senderRecipientRelationship: true,
      },
    });

    await syncSenderRecipientRelationshipFromLetter(
      letterId,
      input.relationshipType ?? currentLetter?.senderRecipientRelationship,
      actor,
      database,
    );
  }

  return result;
}
