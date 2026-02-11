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
export async function generateBiography(personId: string): Promise<string> {
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
      max_completion_tokens: 1024,
      temperature: 0.3, // Low temperature for consistent, factual output
    });

    const duration = Date.now() - start;
    const biography = response.choices[0]?.message?.content?.trim() ?? '';
    const usage = response.usage;

    log.info(
      {
        ...context,
        duration,
        model: env.OPENAI_MODEL,
        biographyLength: biography.length,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
      },
      'Biography generation completed'
    );

    logIfSlow(log, 'Biography generation', duration, TIMING_THRESHOLDS.OPENAI_API, context);

    return biography;
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
): string {
  const relationshipStr =
    relationships.length > 0
      ? relationships.map((r) => `${r.type} of ${r.name}`).join(', ')
      : 'no known relationships';

  return `[STUB BIOGRAPHY - OpenAI API key not configured]

${personName} appears in ${letterSummaries.length} letters in the archive. Known relationships: ${relationshipStr}.

Set OPENAI_API_KEY for AI-generated biography content.`;
}
