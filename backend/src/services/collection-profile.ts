/**
 * Collection Profile Aggregation Service
 *
 * Computes derived data for the public collection profile page.
 * All functions here work from existing extracted data — no AI calls.
 */

import { eq, and, asc, isNotNull, sql } from 'drizzle-orm';
import { db, letters, letterPersons, canonicalPersons } from '../db/index.js';
import {
  getPersonsForCollection,
  getRelationshipsForCollection,
} from './entities/collection-queries.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SentimentPoint {
  date: string;
  tone: string;
  letterId: string;
}

export interface TopicPoint {
  date: string;
  topics: string[];
  letterId: string;
}

export interface NetworkNode {
  id: string;
  name: string;
  letterCount: number;
  biography: string | null;
}

export interface NetworkEdge {
  source: string;
  target: string;
  count: number;
  type: string | null;
}

export interface CorrespondenceNetwork {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface OnThisDayEntry {
  letterId: string;
  date: string;
  hook: string | null;
  sender: string | null;
  recipient: string | null;
  yearsAgo: number;
}

export interface KeyPerson {
  id: string;
  name: string;
  biography: string | null;
  hook: string | null;
  letterCount: number;
  roles: { sender: number; recipient: number };
}

export interface FormatCount {
  type: string;
  label: string;
  count: number;
}

export interface CollectionProfileAggregations {
  sentimentArc: SentimentPoint[];
  topicEvolution: TopicPoint[];
  correspondenceNetwork: CorrespondenceNetwork;
  onThisDay: OnThisDayEntry[];
  keyPeople: KeyPerson[];
  formatBreakdown: FormatCount[];
  dateRange: { start: string; end: string } | null;
  letterCount: number;
}

// ============================================================================
// MAIN AGGREGATION
// ============================================================================

export async function getCollectionAggregations(collectionId: string): Promise<CollectionProfileAggregations> {
  // Fetch published letters in one query
  const publishedLetters = await db.query.letters.findMany({
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
      hook: true,
      emotionalTone: true,
      primaryTopics: true,
      type: true,
    },
  });

  // Run independent aggregations in parallel
  const [persons, relationships] = await Promise.all([
    getPersonsForCollection(collectionId),
    getRelationshipsForCollection(collectionId),
  ]);

  // Sentiment arc
  const sentimentArc: SentimentPoint[] = publishedLetters
    .filter(l => l.emotionalTone && l.type === 'L')
    .map(l => ({
      date: l.letterDate || l.dateRaw,
      tone: l.emotionalTone!,
      letterId: l.id,
    }));

  // Topic evolution
  const topicEvolution: TopicPoint[] = publishedLetters
    .filter(l => l.primaryTopics && l.primaryTopics.length > 0 && l.type === 'L')
    .map(l => ({
      date: l.letterDate || l.dateRaw,
      topics: l.primaryTopics!,
      letterId: l.id,
    }));

  // Correspondence network
  const correspondenceNetwork = buildCorrespondenceNetwork(publishedLetters, persons, relationships);

  // On this day
  const onThisDay = computeOnThisDay(publishedLetters);

  // Key people (top 10)
  const keyPeople: KeyPerson[] = persons.slice(0, 10).map(p => ({
    id: p.id,
    name: p.canonicalName,
    biography: p.biography,
    hook: p.hook,
    letterCount: p.letterCount,
    roles: { sender: p.senderCount, recipient: p.recipientCount },
  }));

  // Format breakdown
  const formatBreakdown = computeFormatBreakdown(publishedLetters);

  // Date range
  const dates = publishedLetters
    .map(l => l.letterDate || l.dateRaw)
    .filter(Boolean)
    .sort();
  const dateRange = dates.length > 0
    ? { start: dates[0], end: dates[dates.length - 1] }
    : null;

  return {
    sentimentArc,
    topicEvolution,
    correspondenceNetwork,
    onThisDay,
    keyPeople,
    formatBreakdown,
    dateRange,
    letterCount: publishedLetters.length,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function buildCorrespondenceNetwork(
  publishedLetters: Array<{ id: string; sender: string | null; recipient: string | null; type: string }>,
  persons: Array<{ id: string; canonicalName: string; biography: string | null; letterCount: number }>,
  relationships: Array<{ personAId: string; personAName: string; personBId: string; personBName: string; relationshipType: string }>,
): CorrespondenceNetwork {
  // Build edges from sender→recipient pairs in actual letters
  const edgeCounts = new Map<string, { source: string; target: string; count: number }>();

  for (const letter of publishedLetters) {
    if (!letter.sender || !letter.recipient || letter.type !== 'L') continue;
    const key = [letter.sender, letter.recipient].sort().join('|||');
    const existing = edgeCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      edgeCounts.set(key, {
        source: letter.sender,
        target: letter.recipient,
        count: 1,
      });
    }
  }

  // Build relationship type map for edges
  const relTypeMap = new Map<string, string>();
  for (const rel of relationships) {
    const key = [rel.personAName, rel.personBName].sort().join('|||');
    relTypeMap.set(key, rel.relationshipType);
  }

  // Cap nodes at 15 for readability
  const topPersons = persons.slice(0, 15);
  const topNames = new Set(topPersons.map(p => p.canonicalName.toLowerCase()));

  const nodes: NetworkNode[] = topPersons.map(p => ({
    id: p.id,
    name: p.canonicalName,
    letterCount: p.letterCount,
    biography: p.biography,
  }));

  const edges: NetworkEdge[] = [];
  for (const edge of edgeCounts.values()) {
    // Only include edges where both parties are in the top nodes
    if (topNames.has(edge.source.toLowerCase()) && topNames.has(edge.target.toLowerCase())) {
      const key = [edge.source, edge.target].sort().join('|||');
      edges.push({
        source: edge.source,
        target: edge.target,
        count: edge.count,
        type: relTypeMap.get(key) ?? null,
      });
    }
  }

  return { nodes, edges };
}

function computeOnThisDay(
  publishedLetters: Array<{ id: string; letterDate: string | null; dateRaw: string; hook: string | null; sender: string | null; recipient: string | null; type: string }>,
): OnThisDayEntry[] {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const currentYear = now.getFullYear();

  const matches: OnThisDayEntry[] = [];

  for (const letter of publishedLetters) {
    if (letter.type !== 'L') continue;
    const dateStr = letter.letterDate || letter.dateRaw;
    if (!dateStr) continue;

    // Parse YYYY-MM-DD or YYYYMMDD
    let month: number, day: number, year: number;
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      year = parseInt(parts[0]);
      month = parseInt(parts[1]);
      day = parseInt(parts[2]);
    } else if (dateStr.length === 8) {
      year = parseInt(dateStr.substring(0, 4));
      month = parseInt(dateStr.substring(4, 6));
      day = parseInt(dateStr.substring(6, 8));
    } else {
      continue;
    }

    if (isNaN(month) || isNaN(day) || isNaN(year)) continue;

    // Within ±7 days (wrapping around month boundaries approximately)
    const dayDiff = Math.abs(
      (month * 31 + day) - (currentMonth * 31 + currentDay)
    );
    if (dayDiff <= 7 || dayDiff >= (12 * 31 - 7)) {
      matches.push({
        letterId: letter.id,
        date: dateStr,
        hook: letter.hook,
        sender: letter.sender,
        recipient: letter.recipient,
        yearsAgo: currentYear - year,
      });
    }
  }

  // Sort by closest to today
  matches.sort((a, b) => {
    const aDiff = Math.abs(a.yearsAgo);
    const bDiff = Math.abs(b.yearsAgo);
    return aDiff - bDiff;
  });

  return matches.slice(0, 5);
}

const FORMAT_LABELS: Record<string, string> = {
  L: 'Letter',
  P: 'Photo',
  E: 'Ephemera',
  V: 'Voice',
  A: 'Article',
  D: 'Diary',
  C: 'Cover',
  N: 'Card',
  T: 'Telegram',
};

function computeFormatBreakdown(
  publishedLetters: Array<{ type: string }>,
): FormatCount[] {
  const counts = new Map<string, number>();
  for (const letter of publishedLetters) {
    counts.set(letter.type, (counts.get(letter.type) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([type, count]) => ({
      type,
      label: FORMAT_LABELS[type] || type,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
