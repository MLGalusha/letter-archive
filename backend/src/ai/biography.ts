import OpenAI from 'openai';
import { env, hasOpenAI } from '../config/env.js';
import { BIOGRAPHY_SYSTEM_PROMPT, buildBiographyUserPrompt } from './prompts.js';
import {
  getCanonicalPersonById,
  getRelationshipsForPerson,
  getLettersForPersonEnriched,
} from '../services/entities.js';
import { createLogger, logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';

const log = createLogger({ module: 'biography' });

// Initialize OpenAI client only if API key is available
const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

/**
 * Generate a biography for a person based on their letters and relationships.
 * Returns stub data if OPENAI_API_KEY is not set.
 */
export interface BiographyResult {
  biography: string;
  hook: string;
}

export async function generateBiography(personId: string): Promise<BiographyResult> {
  const context = { personId };

  // Get person data
  const person = await getCanonicalPersonById(personId);
  if (!person) {
    throw new Error(`Person not found: ${personId}`);
  }

  // Get relationships
  const relationshipData = await getRelationshipsForPerson(personId);
  const relationships = relationshipData.map((r) => ({
    name: r.personAId === personId ? r.personBName : r.personAName,
    type: r.relationshipType,
  }));

  // Get letters with summaries
  const letters = await getLettersForPersonEnriched(personId);
  const letterSummaries = letters
    .filter((l) => l.summary) // Only include letters with summaries
    .map((l) => ({
      date: l.letterDate || l.dateRaw,
      summary: l.summary!,
      role: l.role as 'sender' | 'recipient' | 'mentioned',
    }));

  if (!hasOpenAI || !openai) {
    log.debug(context, 'Using stub biography (no API key)');
    return generateStubBiography(person.canonicalName, relationships, letterSummaries);
  }

  log.info(
    {
      ...context,
      personName: person.canonicalName,
      relationshipCount: relationships.length,
      letterCount: letterSummaries.length,
    },
    'Starting biography generation'
  );
  const start = Date.now();

  try {
    const userPrompt = buildBiographyUserPrompt(
      person.canonicalName,
      relationships,
      letterSummaries
    );

    const response = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: BIOGRAPHY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1024,
      temperature: 0.3, // Low temperature for consistent, factual output
    });

    const duration = Date.now() - start;
    const content = response.choices[0]?.message?.content?.trim() ?? '';
    const usage = response.usage;

    // Parse JSON response
    let biography: string;
    let hook: string;
    try {
      const parsed = JSON.parse(content);
      biography = typeof parsed.biography === 'string' ? parsed.biography : content;
      hook = typeof parsed.hook === 'string' ? parsed.hook : '';
    } catch {
      // Fallback: treat entire response as biography if JSON parse fails
      biography = content;
      hook = '';
    }

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        biographyLength: biography.length,
        hookLength: hook.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
      },
      'Biography generation completed'
    );

    logIfSlow(log, 'Biography generation', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return { biography, hook };
  } catch (error) {
    const duration = Date.now() - start;
    log.error(
      {
        ...context,
        duration,
        err: error,
        model: env.OPENAI_MODEL,
      },
      'Biography generation failed'
    );
    throw error;
  }
}

function generateStubBiography(
  personName: string,
  relationships: Array<{ name: string; type: string }>,
  letterSummaries: Array<{ date: string; summary: string; role: string }>
): BiographyResult {
  const relationshipStr =
    relationships.length > 0
      ? relationships.map((r) => `${r.type} of ${r.name}`).join(', ')
      : 'no known relationships';

  return {
    biography: `[STUB BIOGRAPHY - OpenAI API key not configured]\n\n${personName} appears in ${letterSummaries.length} letters in the archive. Known relationships: ${relationshipStr}.\n\nSet OPENAI_API_KEY for AI-generated biography content.`,
    hook: `[STUB] ${personName} — appears in ${letterSummaries.length} letters.`,
  };
}
