import type { KeyPerson } from "../api/collections";
import type { Letter, LetterImageType } from "../types/Letter";
import { getMediaLabel, getPrimaryImage, getPrimaryMediaType } from "../utils/letterPreview";

/* ------------------------------------------------------------------ */
/*  Facet types                                                        */
/* ------------------------------------------------------------------ */

export interface CollectionFacet {
  value: string;
  count: number;
}

export interface CollectionFormatFacet {
  value: LetterImageType;
  label: string;
  count: number;
}

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

export interface CollectionStats {
  dateSpan: { start: string; end: string; label: string } | null;
  writingFrequency: string | null;
  formatBreakdown: string;
  largestGap: { days: number; afterDate: string; label: string } | null;
  totalWords: number;
}

function parseDateRaw(raw: string | undefined | null): Date | null {
  if (!raw || raw.length < 8) return null;
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length < 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6)) - 1;
  const day = Number(digits.slice(6, 8));
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return new Date(year, month, day);
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural || singular + "s"}`;
}

const FORMAT_LABELS: Record<LetterImageType, [string, string]> = {
  letter: ["letter", "letters"],
  photo: ["photo", "photos"],
  telegram: ["telegram", "telegrams"],
  cover: ["cover", "covers"],
  card: ["card", "cards"],
  ephemera: ["ephemeron", "ephemera"],
  article: ["article", "articles"],
  diary: ["diary entry", "diary entries"],
  voice: ["voice recording", "voice recordings"],
};

const FORMAT_DISPLAY_ORDER: LetterImageType[] = [
  "letter", "photo", "telegram", "cover", "card", "ephemera", "article", "diary", "voice",
];

export function computeCollectionStats(letters: Letter[]): CollectionStats {
  const dated = letters
    .map((l) => ({ letter: l, date: parseDateRaw(l.metadata.dateRaw) }))
    .filter((entry): entry is { letter: Letter; date: Date } => entry.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Date span
  let dateSpan: CollectionStats["dateSpan"] = null;
  if (dated.length >= 2) {
    const start = dated[0].date;
    const end = dated[dated.length - 1].date;
    dateSpan = {
      start: formatDateShort(start),
      end: formatDateShort(end),
      label: `${formatDateShort(start)} \u2014 ${formatDateShort(end)}`,
    };
  } else if (dated.length === 1) {
    const d = formatDateShort(dated[0].date);
    dateSpan = { start: d, end: d, label: d };
  }

  // Writing frequency
  let writingFrequency: string | null = null;
  if (dated.length >= 2) {
    const totalDays = daysBetween(dated[0].date, dated[dated.length - 1].date);
    const avgGap = totalDays / (dated.length - 1);
    if (avgGap < 1.5) {
      writingFrequency = "wrote nearly every day";
    } else if (avgGap < 3.5) {
      writingFrequency = `wrote every ~${Math.round(avgGap)} days`;
    } else if (avgGap < 8) {
      writingFrequency = "wrote about once a week";
    } else if (avgGap < 20) {
      writingFrequency = "wrote every few weeks";
    } else {
      writingFrequency = "wrote occasionally";
    }
  }

  // Format breakdown
  const formatCounts = new Map<LetterImageType, number>();
  for (const letter of letters) {
    const mediaType = getPrimaryMediaType(letter);
    formatCounts.set(mediaType, (formatCounts.get(mediaType) || 0) + 1);
  }
  const formatParts = FORMAT_DISPLAY_ORDER
    .filter((type) => formatCounts.has(type))
    .map((type) => {
      const count = formatCounts.get(type)!;
      const [singular, plural] = FORMAT_LABELS[type];
      return pluralize(count, singular, plural);
    });
  const formatBreakdown = formatParts.join(", ") || `${letters.length} items`;

  // Largest gap
  let largestGap: CollectionStats["largestGap"] = null;
  if (dated.length >= 2) {
    let maxGapDays = 0;
    let maxGapAfterDate = dated[0].date;
    for (let i = 1; i < dated.length; i++) {
      const gap = daysBetween(dated[i - 1].date, dated[i].date);
      if (gap > maxGapDays) {
        maxGapDays = gap;
        maxGapAfterDate = dated[i - 1].date;
      }
    }
    if (maxGapDays >= 7) {
      largestGap = {
        days: maxGapDays,
        afterDate: formatDateShort(maxGapAfterDate),
        label: `${maxGapDays}-day gap after ${formatDateShort(maxGapAfterDate)}`,
      };
    }
  }

  // Total word count
  const totalWords = letters.reduce((sum, l) => {
    const text = l.transcript?.fullText;
    if (!text) return sum;
    return sum + text.split(/\s+/).filter(Boolean).length;
  }, 0);

  return { dateSpan, writingFrequency, formatBreakdown, largestGap, totalWords };
}

/* ------------------------------------------------------------------ */
/*  Letter Highlights                                                  */
/* ------------------------------------------------------------------ */

export interface LetterHighlight {
  letter: Letter;
  label: string;
}

/** Returns true when year, month, AND day are all known (non-zero). */
export function hasSpecificDate(dateRaw: string | undefined | null): boolean {
  if (!dateRaw || dateRaw.length < 8) return false;
  const digits = dateRaw.replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length < 8) return false;
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Pick up to 2 highlights:
 *   1. Pinned / Featured (admin pin, or middle letter as fallback)
 *   2. Photo (first photo-type item, if one exists)
 */
export function pickLetterHighlights(
  letters: Letter[],
  startHereLetterId?: string | null,
): LetterHighlight[] {
  if (letters.length === 0) return [];

  const sorted = [...letters].sort((a, b) => {
    const aRaw = a.metadata.dateRaw || "";
    const bRaw = b.metadata.dateRaw || "";
    return aRaw.localeCompare(bRaw);
  });

  const used = new Set<string>();
  const highlights: LetterHighlight[] = [];

  const add = (letter: Letter, label: string) => {
    if (used.has(letter.id)) return;
    used.add(letter.id);
    highlights.push({ letter, label });
  };

  // 1. Pinned / start-here
  if (startHereLetterId) {
    const pinned = letters.find((l) => l.id === startHereLetterId);
    if (pinned) add(pinned, "Pinned");
  }
  if (highlights.length === 0) {
    const candidates = sorted.filter((l) => !used.has(l.id));
    if (candidates.length > 0) {
      const mid = Math.floor(candidates.length / 2);
      add(candidates[mid], "Featured");
    }
  }

  // 2. Photo
  const photo = sorted.find((l) => getPrimaryMediaType(l) === "photo");
  if (photo) add(photo, "Photo");

  return highlights;
}

/* ------------------------------------------------------------------ */
/*  Timeline                                                           */
/* ------------------------------------------------------------------ */

export interface TimelineEntry {
  letterId: string;
  date: string | null;
  dateRaw: string | null;
  dateFormatted: string;
  mediaType: LetterImageType;
  mediaLabel: string;
  hookLine: string;
  sender: string | null;
  recipient: string | null;
  description: string | null;
}

export function buildTimelineEntries(letters: Letter[]): TimelineEntry[] {
  return [...letters]
    .sort((a, b) => {
      const aRaw = a.metadata.dateRaw || "";
      const bRaw = b.metadata.dateRaw || "";
      return aRaw.localeCompare(bRaw);
    })
    .map((letter) => {
      const dateRaw = letter.metadata.dateRaw;
      const parsed = parseDateRaw(dateRaw);
      const mediaType = getPrimaryMediaType(letter);
      const hook = letter.metadata.hook || "";
      const hookLine = hook.length > 100 ? hook.slice(0, 97) + "..." : hook;
      const desc = letter.metadata.description || "";
      const descLine = desc.length > 160 ? desc.slice(0, 157) + "..." : desc;

      return {
        letterId: letter.id,
        date: letter.metadata.date || dateRaw || null,
        dateRaw: dateRaw || null,
        dateFormatted: parsed ? formatDateShort(parsed) : dateRaw || "Undated",
        mediaType,
        mediaLabel: getMediaLabel(mediaType),
        hookLine,
        sender: letter.metadata.sender?.trim() || null,
        recipient: letter.metadata.recipient?.trim() || null,
        description: descLine || null,
      };
    });
}

/* ------------------------------------------------------------------ */
/*  At-a-Glance Facets                                                 */
/* ------------------------------------------------------------------ */

export interface AtAGlanceFacets {
  topics: CollectionFacet[];
  places: CollectionFacet[];
  people: CollectionFacet[];
  formats: CollectionFormatFacet[];
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

export function buildAtAGlanceFacets(letters: Letter[]): AtAGlanceFacets {
  const topicCounts = new Map<string, { label: string; count: number }>();
  const placeCounts = new Map<string, { label: string; count: number }>();
  const peopleCounts = new Map<string, { label: string; count: number }>();
  const formatCounts = new Map<LetterImageType, number>();

  const formatLabels: Record<LetterImageType, string> = {
    letter: "Letters",
    photo: "Photos",
    telegram: "Telegrams",
    cover: "Covers",
    card: "Cards",
    ephemera: "Ephemera",
    article: "Articles",
    diary: "Diary",
    voice: "Voice",
  };

  for (const letter of letters) {
    // Topics (deduplicated per letter)
    const letterTopics = new Set<string>();
    for (const topic of [...(letter.metadata.tags || []), ...(letter.metadata.primaryTopics || [])]) {
      const trimmed = topic?.trim();
      if (!trimmed) continue;
      const key = normalizeValue(trimmed);
      if (letterTopics.has(key)) continue;
      letterTopics.add(key);
      const existing = topicCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        topicCounts.set(key, { label: trimmed, count: 1 });
      }
    }

    // Places (from location field)
    const location = letter.metadata.location?.trim();
    if (location) {
      const key = normalizeValue(location);
      const existing = placeCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        placeCounts.set(key, { label: location, count: 1 });
      }
    }

    // People (sender + recipient, deduplicated per letter)
    const letterPeople = new Set<string>();
    for (const name of [letter.metadata.sender, letter.metadata.recipient]) {
      const trimmed = name?.trim();
      if (!trimmed) continue;
      const key = normalizeValue(trimmed);
      if (letterPeople.has(key)) continue;
      letterPeople.add(key);
      const existing = peopleCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        peopleCounts.set(key, { label: trimmed, count: 1 });
      }
    }

    // Formats
    const mediaType = getPrimaryMediaType(letter);
    formatCounts.set(mediaType, (formatCounts.get(mediaType) || 0) + 1);
  }

  const byCountThenName = (a: CollectionFacet, b: CollectionFacet) =>
    b.count - a.count || a.value.localeCompare(b.value);

  const topics = Array.from(topicCounts.values())
    .map((e) => ({ value: e.label, count: e.count }))
    .sort(byCountThenName)
    .slice(0, 12);

  const places = Array.from(placeCounts.values())
    .map((e) => ({ value: e.label, count: e.count }))
    .sort(byCountThenName)
    .slice(0, 12);

  const people = Array.from(peopleCounts.values())
    .map((e) => ({ value: e.label, count: e.count }))
    .sort(byCountThenName)
    .slice(0, 12);

  const formats = Array.from(formatCounts.entries())
    .map(([value, count]) => ({
      value,
      label: formatLabels[value],
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { topics, places, people, formats };
}

/* ------------------------------------------------------------------ */
/*  Correspondents                                                     */
/* ------------------------------------------------------------------ */

export interface Correspondent {
  name: string;
  sentCount: number;
  receivedCount: number;
  totalLetters: number;
  biography: string | null;
}

export function buildCorrespondents(
  letters: Letter[],
  keyPeople?: KeyPerson[] | null,
): Correspondent[] {
  const map = new Map<string, { name: string; sent: number; received: number }>();

  for (const letter of letters) {
    const sender = letter.metadata.sender?.trim();
    const recipient = letter.metadata.recipient?.trim();

    if (sender) {
      const key = normalizeValue(sender);
      const existing = map.get(key);
      if (existing) {
        existing.sent += 1;
      } else {
        map.set(key, { name: sender, sent: 1, received: 0 });
      }
    }

    if (recipient) {
      const key = normalizeValue(recipient);
      const existing = map.get(key);
      if (existing) {
        existing.received += 1;
      } else {
        map.set(key, { name: recipient, sent: 0, received: 1 });
      }
    }
  }

  // Build bio lookup from keyPeople (normalized name → biography)
  const bioLookup = new Map<string, string>();
  if (keyPeople) {
    for (const person of keyPeople) {
      if (person.biography) {
        bioLookup.set(normalizeValue(person.name), person.biography);
      }
    }
  }

  return Array.from(map.values())
    .map((entry) => ({
      name: entry.name,
      sentCount: entry.sent,
      receivedCount: entry.received,
      totalLetters: entry.sent + entry.received,
      biography: bioLookup.get(normalizeValue(entry.name)) || null,
    }))
    .sort((a, b) => b.totalLetters - a.totalLetters)
    .slice(0, 6);
}
