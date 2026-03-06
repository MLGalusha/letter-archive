import OpenAI from 'openai';
import { eq, asc } from 'drizzle-orm';
import { env, hasOpenAI } from '../config/env.js';
import { COLLECTION_ANALYSIS_SYSTEM_PROMPT, buildCollectionAnalysisPrompt } from './prompts.js';
import { db, letters, collections } from '../db/index.js';
import {
  findMatchingPersons,
  findMatchingPlaces,
  createCanonicalPerson,
  createCanonicalPlace,
  createLetterPerson,
  createLetterPlace,
  addToReviewQueue,
  createRelationship,
  type MatchResult,
} from '../services/entities.js';
import type { PersonRole, PlaceRole, PlaceType, PersonRelationshipType } from '../db/schema.js';
import { createLogger, logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';

const log = createLogger({ module: 'analyze-collection' });

// Initialize OpenAI client only if API key is available
const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

// ============================================================================
// TYPES
// ============================================================================

interface AnalysisEntity {
  name: string;
  role: 'sender' | 'recipient' | 'mentioned';
  letterCount: number;
}

interface AnalysisPlace {
  name: string;
  type: 'city' | 'region' | 'country' | 'street' | 'landmark' | 'other';
  letterCount: number;
}

interface AnalysisRelationship {
  person1: string;
  person2: string;
  type: string;
  evidence: string;
}

interface AnalysisDuplicate {
  name1: string;
  name2: string;
  confidence: number;
  reason: string;
}

interface CollectionAnalysisResult {
  people: AnalysisEntity[];
  places: AnalysisPlace[];
  relationships: AnalysisRelationship[];
  potentialDuplicates: AnalysisDuplicate[];
}

export interface AnalyzeCollectionResult {
  collectionId: string;
  collectionCode: string;
  letterCount: number;
  analysis: CollectionAnalysisResult;
  stats: {
    peopleFound: number;
    placesFound: number;
    relationshipsFound: number;
    duplicatesFound: number;
    entitiesCreated: number;
    entitiesLinked: number;
    itemsQueuedForReview: number;
  };
  isStub: boolean;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Analyze a collection to discover entities, relationships, and potential duplicates.
 *
 * Flow:
 * 1. Get all letters in collection with summaries
 * 2. Send to OpenAI for analysis
 * 3. For each person/place found:
 *    - High confidence match (>=85%): auto-link
 *    - Medium confidence (50-84%): queue for review
 *    - No match: create new entity
 * 4. For relationships: create if both people exist
 * 5. Return analysis results
 */
export async function analyzeCollection(collectionId: string): Promise<AnalyzeCollectionResult> {
  const context = { collectionId };

  // Get collection info
  const collection = await db.query.collections.findFirst({
    where: eq(collections.id, collectionId),
  });

  if (!collection) {
    throw new Error(`Collection not found: ${collectionId}`);
  }

  // Get letters with summaries
  const collectionLetters = await db.query.letters.findMany({
    where: eq(letters.collectionId, collectionId),
    orderBy: [asc(letters.letterDate), asc(letters.dateRaw)],
  });

  const lettersWithSummaries = collectionLetters
    .filter((l) => l.summary || l.sender || l.recipient)
    .map((l) => ({
      id: l.id,
      date: l.letterDate || l.dateRaw,
      sender: l.sender,
      recipient: l.recipient,
      summary: l.summary,
      hook: l.hook,
    }));

  if (lettersWithSummaries.length === 0) {
    log.warn({ ...context, letterCount: collectionLetters.length }, 'No letters with summaries to analyze');
    return {
      collectionId,
      collectionCode: collection.collectionCode,
      letterCount: collectionLetters.length,
      analysis: { people: [], places: [], relationships: [], potentialDuplicates: [] },
      stats: {
        peopleFound: 0,
        placesFound: 0,
        relationshipsFound: 0,
        duplicatesFound: 0,
        entitiesCreated: 0,
        entitiesLinked: 0,
        itemsQueuedForReview: 0,
      },
      isStub: false,
    };
  }

  // Get AI analysis
  let analysis: CollectionAnalysisResult;
  let isStub = false;

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub analysis (no API key)');
    analysis = generateStubAnalysis(lettersWithSummaries);
    isStub = true;
  } else {
    analysis = await callOpenAIForAnalysis(lettersWithSummaries, context);
  }

  // Process the analysis results
  const stats = await processAnalysisResults(analysis, collectionLetters, context);

  return {
    collectionId,
    collectionCode: collection.collectionCode,
    letterCount: lettersWithSummaries.length,
    analysis,
    stats,
    isStub,
  };
}

// ============================================================================
// OPENAI CALL
// ============================================================================

async function callOpenAIForAnalysis(
  lettersData: Array<{ date: string; sender: string | null; recipient: string | null; summary: string | null; hook: string | null }>,
  context: Record<string, unknown>
): Promise<CollectionAnalysisResult> {
  log.info({ ...context, letterCount: lettersData.length }, 'Starting collection analysis');
  const start = Date.now();

  try {
    const userPrompt = buildCollectionAnalysisPrompt(lettersData);

    const response = await openai!.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: COLLECTION_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
      temperature: 0.2,
    });

    const duration = Date.now() - start;
    const content = response.choices[0]?.message?.content;
    const usage = response.usage;

    if (!content) {
      throw new Error('No response from OpenAI for collection analysis');
    }

    let parsed: CollectionAnalysisResult;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      log.error({ ...context, duration, content: content.substring(0, 500) }, 'Failed to parse collection analysis JSON');
      throw new Error('Invalid JSON response from OpenAI for collection analysis');
    }

    // Validate and normalize the response - guard against non-object responses
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      log.warn({ ...context, parsedType: typeof parsed }, 'Collection analysis returned non-object, defaulting to empty');
      parsed = { people: [], places: [], relationships: [], potentialDuplicates: [] };
    } else {
      parsed = {
        people: Array.isArray(parsed.people) ? parsed.people : [],
        places: Array.isArray(parsed.places) ? parsed.places : [],
        relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
        potentialDuplicates: Array.isArray(parsed.potentialDuplicates) ? parsed.potentialDuplicates : [],
      };
    }

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        peopleFound: parsed.people.length,
        placesFound: parsed.places.length,
        relationshipsFound: parsed.relationships.length,
        duplicatesFound: parsed.potentialDuplicates.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
      },
      'Collection analysis completed'
    );

    logIfSlow(log, 'Collection analysis', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return parsed;
  } catch (error) {
    const duration = Date.now() - start;
    log.error({ ...context, duration, err: error }, 'Collection analysis failed');
    throw error;
  }
}

// ============================================================================
// PROCESS RESULTS
// ============================================================================

async function processAnalysisResults(
  analysis: CollectionAnalysisResult,
  collectionLetters: Array<{ id: string; sender: string | null; recipient: string | null }>,
  context: Record<string, unknown>
): Promise<{
  peopleFound: number;
  placesFound: number;
  relationshipsFound: number;
  duplicatesFound: number;
  entitiesCreated: number;
  entitiesLinked: number;
  itemsQueuedForReview: number;
}> {
  let entitiesCreated = 0;
  let entitiesLinked = 0;
  let itemsQueuedForReview = 0;

  // Map name -> entity ID for relationship creation
  const personIdMap = new Map<string, string>();

  // Process people
  for (const person of analysis.people) {
    const result = await processEntity('person', person.name, person.role, collectionLetters, context);
    if (result.created) entitiesCreated++;
    if (result.linked) entitiesLinked++;
    if (result.queued) itemsQueuedForReview++;
    if (result.entityId) {
      personIdMap.set(person.name.toLowerCase(), result.entityId);
    }
  }

  // Process places
  for (const place of analysis.places) {
    const result = await processEntity('place', place.name, 'mentioned', collectionLetters, context, place.type);
    if (result.created) entitiesCreated++;
    if (result.linked) entitiesLinked++;
    if (result.queued) itemsQueuedForReview++;
  }

  // Process relationships
  for (const rel of analysis.relationships) {
    const person1Id = personIdMap.get(rel.person1.toLowerCase());
    const person2Id = personIdMap.get(rel.person2.toLowerCase());

    if (person1Id && person2Id && person1Id !== person2Id) {
      try {
        const relType = mapRelationshipType(rel.type);
        await createRelationship({
          personAId: person1Id,
          personBId: person2Id,
          relationshipType: relType,
          notes: rel.evidence,
          confidence: 80, // AI-discovered relationships have moderate confidence
        });
        log.debug(
          { ...context, person1: rel.person1, person2: rel.person2, type: relType },
          'Created relationship from analysis'
        );
      } catch (err) {
        // Duplicate relationship is fine, just log and continue
        log.debug({ ...context, person1: rel.person1, person2: rel.person2, err }, 'Relationship already exists or failed');
      }
    }
  }

  // Queue potential duplicates for review
  for (const dup of analysis.potentialDuplicates) {
    // Only queue if confidence is in review range (50-84%)
    if (dup.confidence >= 0.5 && dup.confidence < 0.85) {
      // Find if either name matches an existing entity
      const matches1 = await findMatchingPersons(dup.name1, 1);
      const matches2 = await findMatchingPersons(dup.name2, 1);

      if (matches1.length > 0 || matches2.length > 0) {
        const match = matches1[0] || matches2[0];
        await addToReviewQueue({
          entityType: 'person',
          extractedText: `${dup.name1} / ${dup.name2}`,
          letterId: collectionLetters[0]?.id || '', // Use first letter as reference
          suggestedEntityId: match?.entityId,
          context: `Potential duplicate: ${dup.reason}`,
          confidence: Math.round(dup.confidence * 100),
        });
        itemsQueuedForReview++;
      }
    }
  }

  return {
    peopleFound: analysis.people.length,
    placesFound: analysis.places.length,
    relationshipsFound: analysis.relationships.length,
    duplicatesFound: analysis.potentialDuplicates.length,
    entitiesCreated,
    entitiesLinked,
    itemsQueuedForReview,
  };
}

async function processEntity(
  type: 'person' | 'place',
  name: string,
  role: string,
  collectionLetters: Array<{ id: string; sender: string | null; recipient: string | null }>,
  context: Record<string, unknown>,
  placeType?: string
): Promise<{ entityId?: string; created: boolean; linked: boolean; queued: boolean }> {
  // Find matching entities
  const matches: MatchResult[] =
    type === 'person' ? await findMatchingPersons(name) : await findMatchingPlaces(name);

  const bestMatch = matches[0];

  // Find a relevant letter (where this entity might be sender/recipient)
  const relevantLetter = collectionLetters.find(
    (l) =>
      l.sender?.toLowerCase().includes(name.toLowerCase()) ||
      l.recipient?.toLowerCase().includes(name.toLowerCase())
  ) || collectionLetters[0];

  if (bestMatch && bestMatch.similarity >= 85) {
    // HIGH CONFIDENCE: Auto-link to existing entity
    if (type === 'person') {
      await createLetterPerson({
        letterId: relevantLetter.id,
        personId: bestMatch.entityId,
        role: role as PersonRole,
        nameAsWritten: name,
        confidence: bestMatch.similarity,
      });
    } else {
      await createLetterPlace({
        letterId: relevantLetter.id,
        placeId: bestMatch.entityId,
        role: role as PlaceRole,
        nameAsWritten: name,
        confidence: bestMatch.similarity,
      });
    }
    log.debug({ ...context, type, name, matchedTo: bestMatch.canonicalName }, 'Auto-linked entity');
    return { entityId: bestMatch.entityId, created: false, linked: true, queued: false };
  } else if (bestMatch && bestMatch.similarity >= 50) {
    // MEDIUM CONFIDENCE: Add to review queue
    await addToReviewQueue({
      entityType: type,
      extractedText: name,
      letterId: relevantLetter.id,
      suggestedEntityId: bestMatch.entityId,
      context: `Collection analysis suggested match to ${bestMatch.canonicalName}`,
      confidence: bestMatch.similarity,
    });
    log.debug({ ...context, type, name, suggestedMatch: bestMatch.canonicalName }, 'Queued for review');
    return { entityId: bestMatch.entityId, created: false, linked: false, queued: true };
  } else {
    // NO MATCH: Create new entity
    let entityId: string;
    if (type === 'person') {
      entityId = await createCanonicalPerson({ canonicalName: name });
      await createLetterPerson({
        letterId: relevantLetter.id,
        personId: entityId,
        role: role as PersonRole,
        nameAsWritten: name,
        confidence: 100,
      });
    } else {
      entityId = await createCanonicalPlace({
        canonicalName: name,
        placeType: mapPlaceType(placeType || 'other'),
      });
      await createLetterPlace({
        letterId: relevantLetter.id,
        placeId: entityId,
        role: role as PlaceRole,
        nameAsWritten: name,
        confidence: 100,
      });
    }
    log.debug({ ...context, type, name, entityId }, 'Created new entity');
    return { entityId, created: true, linked: false, queued: false };
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function mapPlaceType(type: string): PlaceType {
  const typeMap: Record<string, PlaceType> = {
    city: 'city',
    region: 'region',
    country: 'country',
    street: 'street',
    landmark: 'landmark',
    other: 'other',
  };
  return typeMap[type.toLowerCase()] || 'other';
}

function mapRelationshipType(type: string): PersonRelationshipType {
  const lowerType = type.toLowerCase();
  const typeMap: Record<string, PersonRelationshipType> = {
    spouse: 'spouse',
    'husband': 'spouse',
    'wife': 'spouse',
    'married': 'spouse',
    'fiancé': 'fiancé/fiancée',
    'fiancée': 'fiancé/fiancée',
    'fiancé/fiancée': 'fiancé/fiancée',
    'engaged': 'fiancé/fiancée',
    'romantic-partner': 'romantic-partner',
    'romantic partner': 'romantic-partner',
    'sweetheart': 'romantic-partner',
    'lover': 'romantic-partner',
    'parent': 'parent-child',
    'child': 'parent-child',
    'parent-child': 'parent-child',
    'mother': 'parent-child',
    'father': 'parent-child',
    'son': 'parent-child',
    'daughter': 'parent-child',
    sibling: 'sibling',
    brother: 'sibling',
    sister: 'sibling',
    grandparent: 'grandparent-grandchild',
    grandchild: 'grandparent-grandchild',
    'grandparent-grandchild': 'grandparent-grandchild',
    'aunt/uncle': 'aunt-uncle-niece-nephew',
    'aunt-uncle-niece-nephew': 'aunt-uncle-niece-nephew',
    aunt: 'aunt-uncle-niece-nephew',
    uncle: 'aunt-uncle-niece-nephew',
    'nephew/niece': 'aunt-uncle-niece-nephew',
    nephew: 'aunt-uncle-niece-nephew',
    niece: 'aunt-uncle-niece-nephew',
    cousin: 'cousin',
    'in-law': 'in-law',
    friend: 'friend',
    acquaintance: 'acquaintance',
    'business-associate': 'business-associate',
    colleague: 'business-associate',
    employer: 'employer-employee',
    employee: 'employer-employee',
    'employer-employee': 'employer-employee',
  };

  return typeMap[lowerType] || 'unknown';
}

function generateStubAnalysis(
  lettersData: Array<{ date: string; sender: string | null; recipient: string | null; summary: string | null }>
): CollectionAnalysisResult {
  // Extract unique senders and recipients as stub people
  const people = new Map<string, { name: string; role: 'sender' | 'recipient' | 'mentioned'; letterCount: number }>();

  for (const letter of lettersData) {
    if (letter.sender) {
      const existing = people.get(letter.sender.toLowerCase()) || {
        name: letter.sender,
        role: 'sender' as const,
        letterCount: 0,
      };
      existing.letterCount++;
      people.set(letter.sender.toLowerCase(), existing);
    }
    if (letter.recipient) {
      const existing = people.get(letter.recipient.toLowerCase()) || {
        name: letter.recipient,
        role: 'recipient' as const,
        letterCount: 0,
      };
      existing.letterCount++;
      people.set(letter.recipient.toLowerCase(), existing);
    }
  }

  return {
    people: Array.from(people.values()),
    places: [],
    relationships: [],
    potentialDuplicates: [],
  };
}
