import type { Letter } from "../types/Letter";

export interface CollectionFacet {
  value: string;
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
}

export interface CollectionFilters {
  topic: string | null;
  correspondent: string | null;
  threadKey: string | null;
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
      continue;
    }

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

  return { topics, correspondents, threads };
}

export function applyCollectionFilters(
  letters: Letter[],
  filters: CollectionFilters,
): Letter[] {
  const topic = normalizeOptionalValue(filters.topic);
  const correspondent = normalizeOptionalValue(filters.correspondent);
  const threadKey = filters.threadKey?.trim() || null;

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

    return true;
  });
}
