/**
 * Boundary Classifier (Reader View V2)
 *
 * Narrow structural classifier that determines how adjacent body text lines
 * relate to each other. Uses the same tool-calling pattern as breakMap.ts
 * to guarantee the AI cannot modify transcript text.
 *
 * Input:  Unprotected body text lines (standalone blocks already excluded)
 * Output: Boundary decisions between consecutive lines
 */

import { hasOpenAI } from '../../config/env.js';
import { log, openai } from './client.js';
import { logApiUsage } from '../../services/usage-tracking.js';
import type { ReaderSourceLine, ReaderDecision, BoundaryDecision } from '../../types/readerView.js';

const MODEL = 'gpt-5.4-mini';

const SYSTEM_PROMPT = `You are analyzing the structure of a historical handwritten letter transcript.
You will receive a list of body text lines (standalone structural elements like dates, salutations, closings, and signatures have already been removed).

For each BOUNDARY between consecutive lines, classify the structural relationship.

Rules:
- "join_with_space": These lines are part of the same paragraph. The line break is just where the writer's hand hit the edge of the paper.
- "join_remove_hyphen": The previous line ends with a hyphenated word break (e.g. "to-" + "morrow" → "tomorrow"). Join without space and remove the hyphen.
- "new_paragraph": A new paragraph starts here. The writer shifted topic, indented, or started a new thought.
- "uncertain": You cannot tell. Preserve the original line break.

Important:
- Do NOT rewrite or modify any text. You are classifying structure only.
- Page breaks do NOT automatically mean paragraph breaks. Paragraphs frequently continue across pages.
- When uncertain, use "uncertain" — it is better to preserve a break than to wrongly join.
- Blank lines have already been removed and treated as paragraph breaks. You will not see them.
- Indent changes often (but not always) indicate new paragraphs.`;

const BOUNDARY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'classify_boundaries',
    description: 'Classify the structural relationship at each boundary between consecutive lines.',
    parameters: {
      type: 'object' as const,
      properties: {
        decisions: {
          type: 'array' as const,
          description: 'One entry per boundary (between line N and line N+1). Array length should be (number of lines - 1).',
          items: {
            type: 'object' as const,
            properties: {
              afterLineId: {
                type: 'string' as const,
                description: 'The ID of the line BEFORE this boundary.',
              },
              decision: {
                type: 'string' as const,
                enum: ['join_with_space', 'join_remove_hyphen', 'new_paragraph', 'uncertain'],
              },
            },
            required: ['afterLineId', 'decision'],
          },
        },
      },
      required: ['decisions'],
    },
  },
};

/**
 * Heuristic fallback when AI is unavailable.
 * Conservative: treats indent changes as paragraph breaks, everything else as joins.
 */
function heuristicBoundaries(lines: ReaderSourceLine[]): BoundaryDecision[] {
  const decisions: BoundaryDecision[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i];
    const next = lines[i + 1];

    let decision: ReaderDecision;

    // Hyphenation
    if (current.text.trim().match(/[a-zA-Z]-$/) && next.text.trim().match(/^[a-z]/)) {
      decision = 'join_remove_hyphen';
    }
    // Indent change suggests new paragraph
    else if (next.indentHint !== 'none' && current.indentHint === 'none') {
      decision = 'new_paragraph';
    }
    // Short line followed by normal line might be end of paragraph
    else if (current.text.trim().length < 30 && next.text.trim().length > 50) {
      decision = 'new_paragraph';
    }
    // Default: join
    else {
      decision = 'join_with_space';
    }

    decisions.push({ afterLineId: current.id, decision });
  }

  return decisions;
}

/**
 * Classify boundaries between body text lines using AI.
 * Falls back to heuristics if AI is unavailable.
 */
export async function classifyBoundaries(
  lines: ReaderSourceLine[],
  letterId?: string,
): Promise<BoundaryDecision[]> {
  if (lines.length <= 1) return [];

  // Very short texts don't need AI
  if (lines.length <= 4) {
    return heuristicBoundaries(lines);
  }

  if (!openai) {
    log.info({ letterId }, 'No OpenAI key — using heuristic boundary classification');
    return heuristicBoundaries(lines);
  }

  // Build structured input for the AI
  const lineDescriptions = lines.map(line => {
    const parts = [`[${line.id}]`];
    if (line.pageBreakBefore) parts.push('[PAGE BREAK ABOVE]');
    if (line.indentHint !== 'none') parts.push(`[indent:${line.indentHint}]`);
    parts.push(line.text.trim());
    return parts.join(' ');
  }).join('\n');

  const start = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: lineDescriptions },
      ],
      tools: [BOUNDARY_TOOL],
      tool_choice: { type: 'function', function: { name: 'classify_boundaries' } },
      temperature: 0,
    });

    const durationMs = Date.now() - start;
    const usage = response.usage;

    if (usage) {
      logApiUsage({
        letterId,
        callType: 'boundary_classifier',
        model: MODEL,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        durationMs,
      });
    }

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.function.name !== 'classify_boundaries') {
      log.warn({ letterId }, 'AI did not call classify_boundaries — falling back to heuristic');
      return heuristicBoundaries(lines);
    }

    const args = JSON.parse(toolCall.function.arguments) as {
      decisions: { afterLineId: string; decision: string }[];
    };

    // Validate and filter decisions
    const validDecisions = new Set<string>([
      'join_with_space', 'join_remove_hyphen', 'new_paragraph', 'uncertain',
    ]);
    const validLineIds = new Set(lines.map(l => l.id));

    const decisions: BoundaryDecision[] = (args.decisions ?? [])
      .filter(d => validLineIds.has(d.afterLineId) && validDecisions.has(d.decision))
      .map(d => ({
        afterLineId: d.afterLineId,
        decision: d.decision as ReaderDecision,
      }));

    log.info(
      { letterId, lineCount: lines.length, decisionCount: decisions.length, durationMs },
      'Boundary classification complete',
    );

    return decisions;
  } catch (err) {
    log.warn({ letterId, err }, 'Boundary classification AI call failed — falling back to heuristic');
    return heuristicBoundaries(lines);
  }
}
