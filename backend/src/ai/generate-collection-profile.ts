import OpenAI from 'openai';
import { eq, asc, and } from 'drizzle-orm';
import { env, hasOpenAI } from '../config/env.js';
import {
  COLLECTION_PROFILE_SYSTEM_PROMPT,
  buildCollectionProfilePrompt,
  type CollectionProfileLetterInput,
  type LetterPersonEntity,
} from './prompts.js';
import { db, letters, collections } from '../db/index.js';
import { logApiUsage } from '../services/usage-tracking.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger({ module: 'generate-collection-profile' });

const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

// ============================================================================
// TYPES
// ============================================================================

export interface ProfileCorrespondent {
  name: string;
  hook: string | null;
  biography: string | null;
}

export interface CollectionProfileResult {
  hook: string;
  narrative: string;
  correspondents: ProfileCorrespondent[];
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
// ENTITY EXTRACTION HELPERS
// ============================================================================

interface RawExtractedPerson {
  name?: string;
  role?: string;
  narrative?: string;
  emotional_significance?: string;
  details?: Array<{ detail?: string; category?: string }>;
  quotes?: Array<{ text?: string; context?: string }>;
  relationship_to_sender?: string;
}

function extractPersonEntity(
  entityJson: unknown,
  senderName: string | null,
  recipientName: string | null,
  role: 'sender' | 'recipient',
): LetterPersonEntity | null {
  if (!entityJson || typeof entityJson !== 'object') return null;
  const extraction = entityJson as { people?: RawExtractedPerson[] };
  if (!Array.isArray(extraction.people)) return null;

  const targetName = role === 'sender' ? senderName : recipientName;
  if (!targetName) return null;
  const targetLower = targetName.trim().toLowerCase();

  // Find matching person in the extraction by name and role
  const match = extraction.people.find(p => {
    if (!p.name) return false;
    const nameLower = p.name.trim().toLowerCase();
    return nameLower === targetLower && (p.role === role || nameLower === targetLower);
  }) ?? extraction.people.find(p => {
    if (!p.name) return false;
    return p.name.trim().toLowerCase() === targetLower;
  });

  if (!match) return null;

  return {
    name: match.name?.trim() || targetName,
    role,
    narrative: match.narrative?.trim() || null,
    emotionalSignificance: match.emotional_significance?.trim() || null,
    details: Array.isArray(match.details)
      ? match.details.filter(d => d.detail && d.category).map(d => ({ detail: d.detail!, category: d.category! }))
      : [],
    quotes: Array.isArray(match.quotes)
      ? match.quotes.filter(q => q.text).map(q => ({ text: q.text!, context: q.context || '' }))
      : [],
    relationship: match.relationship_to_sender?.trim() || null,
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

  // Gather published letters with metadata and entity extraction
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
      type: true,
      entityExtractionJson: true,
    },
  });

  // Only include type='L' letters
  const letterInputs: CollectionProfileLetterInput[] = collectionLetters
    .filter(l => l.type === 'L')
    .map(l => ({
      id: l.id,
      date: l.letterDate || l.dateRaw,
      sender: l.sender,
      recipient: l.recipient,
      summary: l.summary,
      hook: l.hook,
      senderEntity: extractPersonEntity(l.entityExtractionJson, l.sender, l.recipient, 'sender'),
      recipientEntity: extractPersonEntity(l.entityExtractionJson, l.sender, l.recipient, 'recipient'),
    }));

  if (letterInputs.length === 0) {
    log.warn({ collectionId }, 'No published letters with content for profile generation');
    return {
      hook: '',
      narrative: '',
      correspondents: [],
      isStub: true,
    };
  }

  // Generate
  if (!hasOpenAI || !openai) {
    log.debug({ collectionId }, 'Using stub profile (no API key)');
    return generateStubProfile(letterInputs);
  }

  return callOpenAIForProfile(collection, letterInputs, start);
}

// ============================================================================
// OPENAI CALL
// ============================================================================

async function callOpenAIForProfile(
  collection: { id: string; title: string | null; description: string | null; collectionCode: string },
  letterInputs: CollectionProfileLetterInput[],
  startTime: number,
): Promise<CollectionProfileResult> {
  const collectionId = collection.id;

  log.info(
    { collectionId, letterCount: letterInputs.length },
    'Generating collection profile via AI',
  );

  const userPrompt = buildCollectionProfilePrompt(
    { title: collection.title, description: collection.description },
    letterInputs,
  );

  try {
    const response = await openai!.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: COLLECTION_PROFILE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 6144,
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

    const GENERIC_NAMES = new Set([
      'sender', 'recipient', 'the sender', 'the recipient',
      'the writer', 'the author', 'unknown', 'someone',
    ]);

    const correspondents: ProfileCorrespondent[] = Array.isArray(parsed.correspondents)
      ? (parsed.correspondents as Record<string, unknown>[])
          .filter(c => {
            const name = typeof c.name === 'string' ? c.name.trim() : '';
            return name.length > 0 && !GENERIC_NAMES.has(name.toLowerCase());
          })
          .map(c => ({
            name: String(c.name).trim(),
            hook: typeof c.hook === 'string' && c.hook.trim() ? c.hook.trim() : null,
            biography: typeof c.biography === 'string' && c.biography.trim() ? c.biography.trim() : null,
          }))
      : [];

    const result: CollectionProfileResult = {
      hook: typeof parsed.hook === 'string' ? parsed.hook : '',
      narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
      correspondents,
      isStub: false,
      usage: usage ? { inputTokens: usage.prompt_tokens ?? 0, outputTokens: usage.completion_tokens ?? 0 } : undefined,
    };

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
        correspondentCount: correspondents.length,
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
    hook: `A collection of ${letterInputs.length} letters involving ${allNames || 'unknown correspondents'}. Configure API key for AI-generated hook.`,
    narrative: `This collection contains ${letterInputs.length} letters involving ${allNames || 'unknown correspondents'}. Generate a real profile by configuring an OpenAI API key.`,
    correspondents: [],
    isStub: true,
  };
}
