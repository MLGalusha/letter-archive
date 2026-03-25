import OpenAI from 'openai';
import { eq, asc, and, isNotNull } from 'drizzle-orm';
import { env, hasOpenAI } from '../config/env.js';
import {
  COLLECTION_PROFILE_SYSTEM_PROMPT,
  buildCollectionProfilePrompt,
  type CollectionProfileLetterInput,
  type CollectionProfilePersonInput,
  type CollectionProfileRelationshipInput,
} from './prompts.js';
import { db, letters, collections } from '../db/index.js';
import {
  getPersonsForCollection,
  getRelationshipsForCollection,
} from '../services/entities/collection-queries.js';
import { logApiUsage } from '../services/usage-tracking.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'generate-collection-profile' });

const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

// ============================================================================
// TYPES
// ============================================================================

export interface ReadingPath {
  title: string;
  description: string;
  letterIds: string[];
}

export interface GapAnalysis {
  startDate: string;
  endDate: string;
  description: string;
}

export interface ThemeGroup {
  name: string;
  description: string;
  letterIds: string[];
}

export interface CollectionProfileResult {
  narrative: string;
  startHereLetterId: string | null;
  startHereReason: string;
  readingPaths: ReadingPath[];
  gapAnalysis: GapAnalysis[];
  themes: ThemeGroup[];
  isStub: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface CompletenessResult {
  totalLetters: number;
  publishedLetters: number;
  withTranscripts: number;
  withMetadata: number;
  withEmotionalTone: number;
  withTopics: number;
  completenessScore: number;
  warnings: string[];
}

// ============================================================================
// COMPLETENESS CHECK
// ============================================================================

export async function assessCollectionCompleteness(collectionId: string): Promise<CompletenessResult> {
  const allLetters = await db.query.letters.findMany({
    where: eq(letters.collectionId, collectionId),
    columns: {
      id: true,
      visibility: true,
      transcriptionText: true,
      sender: true,
      recipient: true,
      summary: true,
      emotionalTone: true,
      primaryTopics: true,
      type: true,
    },
  });

  const published = allLetters.filter(l => l.visibility === 'PUBLISHED');
  const typeL = published.filter(l => l.type === 'L');
  const withTranscripts = typeL.filter(l => l.transcriptionText);
  const withMetadata = typeL.filter(l => l.sender || l.recipient || l.summary);
  const withTone = typeL.filter(l => l.emotionalTone);
  const withTopics = typeL.filter(l => l.primaryTopics && l.primaryTopics.length > 0);

  const warnings: string[] = [];
  const denominator = typeL.length || 1;

  if (published.length < 3) {
    warnings.push(`Only ${published.length} published letters — profile may be sparse`);
  }
  if (typeL.length === 0) {
    warnings.push('No letter-type items (type L) found — only extras exist');
  }
  const transcriptPct = withTranscripts.length / denominator;
  if (transcriptPct < 0.5) {
    warnings.push(`Only ${Math.round(transcriptPct * 100)}% of letters have transcripts`);
  }
  const metadataPct = withMetadata.length / denominator;
  if (metadataPct < 0.5) {
    warnings.push(`Only ${Math.round(metadataPct * 100)}% of letters have metadata extracted`);
  }
  if (withTone.length === 0) {
    warnings.push('No emotional tones extracted — sentiment arc will be empty');
  }

  // Score: weighted average of coverage rates
  const score = Math.round(
    (transcriptPct * 40 + metadataPct * 30 + (withTone.length / denominator) * 15 + (withTopics.length / denominator) * 15) * 100
  ) / 100;

  return {
    totalLetters: allLetters.length,
    publishedLetters: published.length,
    withTranscripts: withTranscripts.length,
    withMetadata: withMetadata.length,
    withEmotionalTone: withTone.length,
    withTopics: withTopics.length,
    completenessScore: Math.min(score, 100),
    warnings,
  };
}

// ============================================================================
// GENERATION
// ============================================================================

export async function generateCollectionProfile(collectionId: string): Promise<CollectionProfileResult> {
  const start = Date.now();

  const collection = await db.query.collections.findFirst({
    where: eq(collections.id, collectionId),
  });

  if (!collection) {
    throw new Error(`Collection not found: ${collectionId}`);
  }

  // Gather published letters with metadata
  const collectionLetters = await db.query.letters.findMany({
    where: and(
      eq(letters.collectionId, collectionId),
      eq(letters.visibility, 'PUBLISHED'),
    ),
    orderBy: [asc(letters.letterDate), asc(letters.dateRaw)],
    columns: {
      id: true,
      letterDate: true,
      dateRaw: true,
      sender: true,
      recipient: true,
      summary: true,
      hook: true,
      emotionalTone: true,
      primaryTopics: true,
      locationWritten: true,
      type: true,
    },
  });

  // Only include type='L' letters for profile generation context
  const letterInputs: CollectionProfileLetterInput[] = collectionLetters
    .filter(l => l.type === 'L')
    .map(l => ({
      id: l.id,
      date: l.letterDate || l.dateRaw,
      sender: l.sender,
      recipient: l.recipient,
      summary: l.summary,
      hook: l.hook,
      emotionalTone: l.emotionalTone,
      primaryTopics: l.primaryTopics,
      locationWritten: l.locationWritten,
    }));

  if (letterInputs.length === 0) {
    log.warn({ collectionId }, 'No published letters with content for profile generation');
    return {
      narrative: '',
      startHereLetterId: null,
      startHereReason: '',
      readingPaths: [],
      gapAnalysis: [],
      themes: [],
      isStub: true,
    };
  }

  // Gather people and relationships
  const persons = await getPersonsForCollection(collectionId);
  const relationships = await getRelationshipsForCollection(collectionId);

  const peopleInputs: CollectionProfilePersonInput[] = persons.slice(0, 20).map(p => ({
    name: p.canonicalName,
    biography: p.biography ?? null,
    letterCount: p.letterCount,
    senderCount: p.senderCount,
    recipientCount: p.recipientCount,
  }));

  const relInputs: CollectionProfileRelationshipInput[] = relationships.slice(0, 30).map(r => ({
    personA: r.personAName,
    personB: r.personBName,
    type: r.relationshipType,
  }));

  // Generate
  if (!hasOpenAI || !openai) {
    log.debug({ collectionId }, 'Using stub profile (no API key)');
    return generateStubProfile(letterInputs);
  }

  return callOpenAIForProfile(collection, letterInputs, peopleInputs, relInputs, start);
}

// ============================================================================
// OPENAI CALL
// ============================================================================

async function callOpenAIForProfile(
  collection: { id: string; title: string | null; description: string | null; collectionCode: string },
  letterInputs: CollectionProfileLetterInput[],
  people: CollectionProfilePersonInput[],
  relationships: CollectionProfileRelationshipInput[],
  startTime: number,
): Promise<CollectionProfileResult> {
  const collectionId = collection.id;

  log.info(
    { collectionId, letterCount: letterInputs.length, peopleCount: people.length },
    'Generating collection profile via AI',
  );

  const userPrompt = buildCollectionProfilePrompt(
    { title: collection.title, description: collection.description },
    letterInputs,
    people,
    relationships,
  );

  try {
    const response = await openai!.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: COLLECTION_PROFILE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
      temperature: 0.4,
    });

    const duration = Date.now() - startTime;
    const content = response.choices[0]?.message?.content;
    const usage = response.usage;

    if (!content) {
      throw new Error('No response from OpenAI for collection profile');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      log.error({ collectionId, content: content.substring(0, 500) }, 'Failed to parse profile JSON');
      throw new Error('Invalid JSON response from OpenAI for collection profile');
    }

    // Validate letter IDs referenced in the response
    const validIds = new Set(letterInputs.map(l => l.id));
    const filterIds = (ids: unknown[]): string[] =>
      Array.isArray(ids) ? ids.filter(id => typeof id === 'string' && validIds.has(id)) as string[] : [];

    const readingPaths: ReadingPath[] = Array.isArray(parsed.readingPaths)
      ? (parsed.readingPaths as Record<string, unknown>[]).map(p => ({
          title: String(p.title || ''),
          description: String(p.description || ''),
          letterIds: filterIds(p.letterIds as unknown[]),
        })).filter(p => p.title && p.letterIds.length > 0)
      : [];

    const gapAnalysis: GapAnalysis[] = Array.isArray(parsed.gapAnalysis)
      ? (parsed.gapAnalysis as Record<string, unknown>[]).map(g => ({
          startDate: String(g.startDate || ''),
          endDate: String(g.endDate || ''),
          description: String(g.description || ''),
        })).filter(g => g.startDate && g.endDate)
      : [];

    const themes: ThemeGroup[] = Array.isArray(parsed.themes)
      ? (parsed.themes as Record<string, unknown>[]).map(t => ({
          name: String(t.name || ''),
          description: String(t.description || ''),
          letterIds: filterIds(t.letterIds as unknown[]),
        })).filter(t => t.name && t.letterIds.length > 0)
      : [];

    const startHereLetterId = typeof parsed.startHereLetterId === 'string' && validIds.has(parsed.startHereLetterId)
      ? parsed.startHereLetterId
      : letterInputs[0]?.id ?? null;

    const result: CollectionProfileResult = {
      narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
      startHereLetterId,
      startHereReason: typeof parsed.startHereReason === 'string' ? parsed.startHereReason : '',
      readingPaths,
      gapAnalysis,
      themes,
      isStub: false,
      usage: usage ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } : undefined,
    };

    // Log usage
    if (usage) {
      logApiUsage({
        callType: 'collection_profile',
        model: env.OPENAI_MODEL,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        durationMs: duration,
      });
    }

    log.info(
      {
        collectionId,
        duration,
        narrativeLength: result.narrative.length,
        readingPathCount: readingPaths.length,
        themeCount: themes.length,
        gapCount: gapAnalysis.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
      },
      'Collection profile generated successfully',
    );

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    log.error({ collectionId, duration, err: error }, 'Collection profile generation failed');
    throw error;
  }
}

// ============================================================================
// STUB
// ============================================================================

function generateStubProfile(letterInputs: CollectionProfileLetterInput[]): CollectionProfileResult {
  const senders = new Set(letterInputs.map(l => l.sender).filter(Boolean));
  const recipients = new Set(letterInputs.map(l => l.recipient).filter(Boolean));
  const allNames = [...senders, ...recipients].slice(0, 3).join(', ');

  return {
    narrative: `This collection contains ${letterInputs.length} letters involving ${allNames || 'unknown correspondents'}. Generate a real profile by configuring an OpenAI API key.`,
    startHereLetterId: letterInputs[0]?.id ?? null,
    startHereReason: 'First letter chronologically (stub mode).',
    readingPaths: [],
    gapAnalysis: [],
    themes: [],
    isStub: true,
  };
}
