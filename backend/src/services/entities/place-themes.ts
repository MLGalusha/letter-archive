import OpenAI from 'openai';
import { env, hasOpenAI } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { getLettersForPlaceEnriched } from './junctions.js';
import { getCanonicalPlaceById, updateCanonicalPlace } from './places.js';

const log = createLogger({ module: 'place-themes' });
const openai = hasOpenAI ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

export const PLACE_THEME_START_MARKER = '[AI_PLACE_THEMES_START]';
export const PLACE_THEME_END_MARKER = '[AI_PLACE_THEMES_END]';

export function stripPlaceThemesFromNotes(notes: string | null | undefined): string {
  if (!notes) return '';
  const start = notes.indexOf(PLACE_THEME_START_MARKER);
  const end = notes.indexOf(PLACE_THEME_END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    return notes.trim();
  }

  const before = notes.slice(0, start).trim();
  const after = notes.slice(end + PLACE_THEME_END_MARKER.length).trim();
  return [before, after].filter(Boolean).join('\n\n').trim();
}

export function extractPlaceThemesFromNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  const start = notes.indexOf(PLACE_THEME_START_MARKER);
  const end = notes.indexOf(PLACE_THEME_END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    return [];
  }

  const raw = notes
    .slice(start + PLACE_THEME_START_MARKER.length, end)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- /, '').trim())
    .filter(Boolean);

  return raw;
}

export function upsertPlaceThemesInNotes(
  existingNotes: string | null | undefined,
  themes: string[],
): string {
  const base = stripPlaceThemesFromNotes(existingNotes);
  const cleanedThemes = themes
    .map((theme) => theme.trim())
    .filter((theme) => theme.length > 0);

  const themeBlock = [
    PLACE_THEME_START_MARKER,
    ...cleanedThemes.map((theme) => `- ${theme}`),
    PLACE_THEME_END_MARKER,
  ].join('\n');

  return [base, themeBlock].filter(Boolean).join('\n\n').trim();
}

function buildStubThemes(placeName: string, evidence: string[]): string[] {
  const count = evidence.length;
  return [
    `${placeName} appears repeatedly as a correspondence anchor (${count} references).`,
    'Theme: movement and distance (written-from, destination, and mentions connect journeys).',
    'Theme: personal networks cluster around this place in sender/recipient narratives.',
  ];
}

function parseThemesResponse(responseText: string): string[] {
  try {
    const parsed = JSON.parse(responseText) as { themes?: string[] };
    if (!Array.isArray(parsed.themes)) return [];
    return parsed.themes
      .map((theme) => (typeof theme === 'string' ? theme.trim() : ''))
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export async function generatePlaceThemes(placeId: string): Promise<{
  placeId: string;
  themes: string[];
  notes: string;
}> {
  const place = await getCanonicalPlaceById(placeId);
  if (!place) {
    throw new Error('Place not found');
  }

  const letters = await getLettersForPlaceEnriched(placeId);
  const evidence = letters
    .map((letter) => letter.summary || letter.hook || letter.context || '')
    .filter((value) => value.trim().length > 0)
    .slice(0, 40);

  const fallbackThemes = buildStubThemes(place.canonicalName, evidence);

  let themes = fallbackThemes;
  if (hasOpenAI && openai && evidence.length > 0) {
    try {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature: 0.2,
        max_completion_tokens: 500,
        messages: [
          {
            role: 'system',
            content: [
              'You generate concise place themes for an archive admin.',
              'Return valid JSON with exactly this shape: {"themes": ["...", "..."]}.',
              'Each theme should be one sentence, factual, and based only on evidence.',
              'Do not include markdown.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              place: place.canonicalName,
              role: place.placeType || 'other',
              evidence,
            }),
          },
        ],
      });

      const parsed = parseThemesResponse(
        response.choices[0]?.message?.content?.trim() || '',
      );
      if (parsed.length > 0) {
        themes = parsed;
      }
    } catch (error) {
      log.warn({ placeId, err: error }, 'Theme generation failed, using fallback');
    }
  }

  const updatedNotes = upsertPlaceThemesInNotes(place.notes, themes);
  await updateCanonicalPlace(placeId, { notes: updatedNotes });

  return {
    placeId,
    themes,
    notes: updatedNotes,
  };
}
