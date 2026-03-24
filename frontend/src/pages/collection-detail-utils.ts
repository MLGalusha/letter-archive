import type { Letter, LetterImageType } from "../types/Letter";
import {
  getLetterPreviewText,
  getPrimaryMediaType,
} from "../utils/letterPreview";

export interface CollectionFacet {
  value: string;
  count: number;
}

export interface CollectionFormatFacet {
  value: LetterImageType;
  label: string;
  count: number;
}

export interface CollectionThread {
  key: string;
  sender: string;
  recipient: string;
  count: number;
  latestDate: string | null;
  sampleHook: string | null;
}

export interface CollectionFacets {
  topics: CollectionFacet[];
  correspondents: CollectionFacet[];
  threads: CollectionThread[];
  formats: CollectionFormatFacet[];
}

export interface CollectionFilters {
  topic: string | null;
  correspondent: string | null;
  threadKey: string | null;
  format: LetterImageType | null;
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeOptionalValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeValue(value);
  return normalized || null;
}

function normalizeDateForCompare(value: string | null): string {
  if (!value) return "";
  return value.replace(/[^0-9]/g, "");
}

function getLetterDateValue(letter: Letter): string | null {
  return letter.metadata.date || letter.metadata.dateRaw || null;
}

export function getThreadKey(sender: string | null | undefined, recipient: string | null | undefined): string {
  const from = sender?.trim() || "Unknown sender";
  const to = recipient?.trim() || "Unknown recipient";
  return `${from} -> ${to}`;
}

export function buildCollectionFacets(letters: Letter[]): CollectionFacets {
  const topicCounts = new Map<string, { label: string; count: number }>();
  const correspondentCounts = new Map<string, { label: string; count: number }>();
  const threadMap = new Map<string, CollectionThread>();
  const formatCounts = new Map<LetterImageType, number>();
  const formatLabels: Record<LetterImageType, string> = {
    letter: "Letters",
    photo: "Photos",
    ephemera: "Ephemera",
    voice: "Voice",
    article: "Articles",
    diary: "Diary",
    cover: "Covers",
    card: "Cards",
    telegram: "Telegrams",
  };

  for (const letter of letters) {
    const letterTopics = new Set<string>();
    for (const topic of [...(letter.metadata.tags || []), ...(letter.metadata.primaryTopics || [])]) {
      const normalized = normalizeOptionalValue(topic);
      const display = topic?.trim();
      if (normalized && display) {
        letterTopics.add(normalized);
        if (!topicCounts.has(normalized)) {
          topicCounts.set(normalized, { label: display, count: 0 });
        }
      }
    }

    for (const normalizedTopic of letterTopics) {
      const current = topicCounts.get(normalizedTopic);
      if (current) {
        current.count += 1;
      }
    }

    const correspondentEntries = [letter.metadata.sender, letter.metadata.recipient]
      .map((name) => {
        const trimmed = name?.trim();
        const normalized = normalizeOptionalValue(name);
        if (!trimmed || !normalized) return null;
        return { normalized, display: trimmed };
      })
      .filter((entry): entry is { normalized: string; display: string } => !!entry);
    const uniqueCorrespondents = new Map<string, string>();
    for (const correspondent of correspondentEntries) {
      if (!uniqueCorrespondents.has(correspondent.normalized)) {
        uniqueCorrespondents.set(correspondent.normalized, correspondent.display);
      }
    }

    for (const [correspondent, display] of uniqueCorrespondents) {
      const current = correspondentCounts.get(correspondent);
      if (current) {
        current.count += 1;
      } else {
        correspondentCounts.set(correspondent, { label: display, count: 1 });
      }
    }

    const threadKey = getThreadKey(letter.metadata.sender, letter.metadata.recipient);
    const existingThread = threadMap.get(threadKey);
    const letterDate = getLetterDateValue(letter);

    if (!existingThread) {
      threadMap.set(threadKey, {
        key: threadKey,
        sender: letter.metadata.sender?.trim() || "Unknown sender",
        recipient: letter.metadata.recipient?.trim() || "Unknown recipient",
        count: 1,
        latestDate: letterDate,
        sampleHook: letter.metadata.hook || null,
      });
    } else {
      existingThread.count += 1;
      if (
        normalizeDateForCompare(letterDate) > normalizeDateForCompare(existingThread.latestDate)
      ) {
        existingThread.latestDate = letterDate;
      }
      if (!existingThread.sampleHook && letter.metadata.hook) {
        existingThread.sampleHook = letter.metadata.hook;
      }
    }

    const mediaTypes = new Set<LetterImageType>(
      letter.images.length > 0
        ? letter.images.map((image) => image.type)
        : [getPrimaryMediaType(letter)],
    );
    for (const mediaType of mediaTypes) {
      formatCounts.set(mediaType, (formatCounts.get(mediaType) || 0) + 1);
    }
  }

  const byCountThenName = (a: CollectionFacet, b: CollectionFacet) =>
    b.count - a.count || a.value.localeCompare(b.value);

  const topics = Array.from(topicCounts.values())
    .map((entry) => ({ value: entry.label, count: entry.count }))
    .sort(byCountThenName)
    .slice(0, 12);

  const correspondents = Array.from(correspondentCounts.values())
    .map((entry) => ({ value: entry.label, count: entry.count }))
    .sort(byCountThenName)
    .slice(0, 12);

  const threads = Array.from(threadMap.values())
    .sort((a, b) => {
      const dateSort = normalizeDateForCompare(b.latestDate)!.localeCompare(
        normalizeDateForCompare(a.latestDate)!,
      );
      return b.count - a.count || dateSort || a.key.localeCompare(b.key);
    })
    .slice(0, 8);

  const formats = Array.from(formatCounts.entries())
    .map(([value, count]) => ({
      value,
      label: formatLabels[value],
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8);

  return { topics, correspondents, threads, formats };
}

export function applyCollectionFilters(
  letters: Letter[],
  filters: CollectionFilters,
): Letter[] {
  const topic = normalizeOptionalValue(filters.topic);
  const correspondent = normalizeOptionalValue(filters.correspondent);
  const threadKey = filters.threadKey?.trim() || null;
  const format = filters.format;

  return letters.filter((letter) => {
    if (topic) {
      const topics = new Set(
        [...(letter.metadata.tags || []), ...(letter.metadata.primaryTopics || [])]
          .map(normalizeOptionalValue)
          .filter((value): value is string => !!value),
      );
      if (!topics.has(topic)) {
        return false;
      }
    }

    if (correspondent) {
      const sender = normalizeOptionalValue(letter.metadata.sender);
      const recipient = normalizeOptionalValue(letter.metadata.recipient);
      if (sender !== correspondent && recipient !== correspondent) {
        return false;
      }
    }

    if (threadKey && getThreadKey(letter.metadata.sender, letter.metadata.recipient) !== threadKey) {
      return false;
    }

    if (format) {
      const mediaTypes = new Set<LetterImageType>(
        letter.images.length > 0
          ? letter.images.map((image) => image.type)
          : [getPrimaryMediaType(letter)],
      );
      if (!mediaTypes.has(format)) {
        return false;
      }
    }

    return true;
  });
}

export function pickCollectionHighlights(letters: Letter[], limit = 4): Letter[] {
  return [...letters]
    .sort((a, b) => scoreHighlight(b) - scoreHighlight(a) || compareDatesDesc(a, b))
    .slice(0, limit);
}

function scoreHighlight(letter: Letter): number {
  const primaryType = getPrimaryMediaType(letter);
  const previewText = getLetterPreviewText(letter);
  const peopleLine = letter.metadata.sender || letter.metadata.recipient;
  const tagsCount = (letter.metadata.tags?.length || 0) + (letter.metadata.primaryTopics?.length || 0);

  let score = 0;

  if (primaryType === "photo") score += 120;
  if (primaryType === "telegram") score += 70;
  if (primaryType === "cover" || primaryType === "card" || primaryType === "ephemera") score += 55;

  score += Math.min(letter.images.length, 4) * 18;
  if (previewText) score += 28;
  if (peopleLine) score += 14;
  if (tagsCount > 0) score += Math.min(tagsCount, 3) * 6;

  return score;
}

function compareDatesDesc(a: Letter, b: Letter): number {
  const aDate = normalizeDateForCompare(getLetterDateValue(a));
  const bDate = normalizeDateForCompare(getLetterDateValue(b));
  return bDate.localeCompare(aDate);
}
