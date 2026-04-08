/**
 * Break-Map Reading View Generator
 *
 * Uses gpt-5.4-mini with tool calling to identify paragraph breaks in a transcript.
 * The AI can ONLY call a tool with line numbers — it structurally cannot modify text.
 * Code then mechanically joins lines into paragraphs.
 */

import { hasOpenAI } from '../../config/env.js';
import { log, openai } from './client.js';
import { logApiUsage } from '../../services/usage-tracking.js';

const BREAK_MAP_MODEL = 'gpt-5.4-mini';

const SYSTEM_PROMPT = `You are reading a transcript of a historical handwritten letter. Each line is numbered.
Line breaks in this transcript are where the writer's hand hit the edge of the paper — they are NOT paragraph breaks.
Your job is to identify where the actual paragraph breaks are.

Call the mark_paragraph_breaks tool ONCE with the line numbers that START a new paragraph.

Rules:
- Line 1 is always a paragraph start — do NOT include it.
- A blank line always indicates a paragraph break — include the line number AFTER each blank line.
- Date headers, addresses, salutations ("Dear ..."), closings ("Love,", "Sincerely,"), signatures, and postscripts ("P.S.") are each their own paragraph.
- Within the body of the letter, a new paragraph starts when the writer shifts to a new thought or topic.
- When in doubt, prefer MORE paragraph breaks over fewer — it's easier to join paragraphs than to split them.

Page breaks:
- Lines marked [PAGE BREAK] indicate where one physical page ends and the next begins.
- A page break does NOT automatically mean a paragraph break. Sentences and paragraphs frequently continue across pages.
- If the text before and after a page break reads as one continuous thought, do NOT insert a paragraph break there — the lines will be joined together.
- Only mark a paragraph break at a page boundary if the content genuinely shifts topic or the writer started a new paragraph on the new page (e.g. indentation, new salutation, clear topic change).`;

const BREAK_MAP_TOOL = {
  type: 'function' as const,
  function: {
    name: 'mark_paragraph_breaks',
    description: 'Mark which line numbers start a new paragraph. Lines not listed will be joined to the previous line with a space.',
    parameters: {
      type: 'object' as const,
      properties: {
        breaks: {
          type: 'array' as const,
          description: 'Line numbers (1-based) where a new paragraph begins. Do NOT include line 1.',
          items: { type: 'number' as const },
        },
      },
      required: ['breaks'],
    },
  },
};

/** Page divider pattern used in multi-page transcripts */
const PAGE_DIVIDER_RE = /^-{2,}\s*Page\s+\d+\s*-{2,}$/i;

/** Sentinel value injected in place of page dividers so the AI sees page context */
const PAGE_BREAK_MARKER = '[PAGE BREAK]';

/**
 * Split transcript into lines, replacing page dividers with a marker.
 * Returns the cleaned lines (preserving blank lines).
 */
export function splitTranscriptLines(text: string): string[] {
  return text.split('\n').map(line =>
    PAGE_DIVIDER_RE.test(line.trim()) ? PAGE_BREAK_MARKER : line,
  );
}

/**
 * Apply a break map to transcript lines, producing reading text.
 * Lines at break positions start new paragraphs (separated by \n\n).
 * All other consecutive lines are joined with spaces.
 */
export function applyBreakMap(lines: string[], breakLines: number[]): string {
  if (lines.length === 0) return '';

  const breakSet = new Set(breakLines);
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    const trimmed = lines[i].trim();

    // Skip page break markers — they're context for the AI, not real content
    if (trimmed === PAGE_BREAK_MARKER) continue;

    // Skip blank lines — they're implicit paragraph separators
    if (trimmed === '') {
      if (current.length > 0) {
        paragraphs.push(joinLineGroup(current));
        current = [];
      }
      continue;
    }

    // Start new paragraph if this line is in the break set
    if (breakSet.has(lineNum) && current.length > 0) {
      paragraphs.push(joinLineGroup(current));
      current = [];
    }

    current.push(trimmed);
  }

  // Flush remaining
  if (current.length > 0) {
    paragraphs.push(joinLineGroup(current));
  }

  return paragraphs.join('\n\n').trim();
}

/**
 * Join a group of lines into a single paragraph string.
 * Handles hyphenated word breaks: "un-" + "til" → "until"
 */
function joinLineGroup(lines: string[]): string {
  if (lines.length === 0) return '';
  if (lines.length === 1) return lines[0];

  let result = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const nextLine = lines[i];
    // Hyphen at end of line + next line starts lowercase → join without space, remove hyphen
    if (result.match(/[a-zA-Z]-$/) && nextLine.match(/^[a-z]/)) {
      result = result.slice(0, -1) + nextLine;
    } else {
      result = result + ' ' + nextLine;
    }
  }
  return result;
}

/**
 * Heuristic fallback when no API key is available.
 * Treats blank lines as paragraph breaks, joins everything else.
 */
function heuristicBreakMap(lines: string[]): number[] {
  const breaks: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip page break markers
    if (trimmed === PAGE_BREAK_MARKER) continue;
    // If previous line was blank or a page break marker, this line starts a new paragraph
    const prevTrimmed = lines[i - 1].trim();
    if ((prevTrimmed === '' || prevTrimmed === PAGE_BREAK_MARKER) && trimmed !== '') {
      breaks.push(i + 1); // 1-based
    }
  }
  return breaks;
}

/**
 * Generate reading text from a transcript using AI-determined paragraph breaks.
 *
 * @param transcriptText - The raw transcript text (with original line breaks)
 * @param letterId - Optional letter ID for usage logging
 * @returns The reading-view text with paragraphs separated by \n\n
 */
export async function generateBreakMap(transcriptText: string, letterId?: string): Promise<string> {
  const lines = splitTranscriptLines(transcriptText);
  const nonBlankLines = lines.filter(l => l.trim() !== '' && l.trim() !== PAGE_BREAK_MARKER);

  // Very short transcripts don't need AI
  if (nonBlankLines.length <= 3) {
    return applyBreakMap(lines, heuristicBreakMap(lines));
  }

  // Stub mode — no API key
  if (!openai) {
    log.info({ letterId }, 'No OpenAI key — using heuristic break map');
    return applyBreakMap(lines, heuristicBreakMap(lines));
  }

  // Build numbered lines for the AI
  const numberedText = lines
    .map((line, i) => `${i + 1}: ${line}`)
    .join('\n');

  const start = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: BREAK_MAP_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: numberedText },
      ],
      tools: [BREAK_MAP_TOOL],
      tool_choice: { type: 'function', function: { name: 'mark_paragraph_breaks' } },
      temperature: 0,
    });

    const durationMs = Date.now() - start;
    const usage = response.usage;

    // Log usage
    if (usage) {
      logApiUsage({
        letterId,
        callType: 'break_map',
        model: BREAK_MAP_MODEL,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        durationMs,
      });
    }

    // Parse tool call
    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'mark_paragraph_breaks') {
      log.warn({ letterId }, 'AI did not call mark_paragraph_breaks — falling back to heuristic');
      return applyBreakMap(lines, heuristicBreakMap(lines));
    }

    const args = JSON.parse(toolCall.function.arguments) as { breaks: number[] };
    const breakLines = (args.breaks ?? [])
      .filter((n: number) => Number.isInteger(n) && n >= 2 && n <= lines.length);

    log.info(
      { letterId, totalLines: lines.length, breakCount: breakLines.length, durationMs },
      'Break map generated',
    );

    return applyBreakMap(lines, breakLines);
  } catch (err) {
    log.warn({ letterId, err }, 'Break map AI call failed — falling back to heuristic');
    return applyBreakMap(lines, heuristicBreakMap(lines));
  }
}
