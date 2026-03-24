import type { Letter, LetterImage, LetterImageType } from "../types/Letter";

const MEDIA_LABELS: Record<LetterImageType, string> = {
  letter: "Letter",
  photo: "Photo",
  ephemera: "Ephemera",
  voice: "Voice",
  article: "Article",
  diary: "Diary",
  cover: "Cover",
  card: "Card",
  telegram: "Telegram",
};

const MEDIA_COUNT_LABELS: Record<LetterImageType, [string, string]> = {
  letter: ["page", "pages"],
  photo: ["photo", "photos"],
  ephemera: ["piece", "pieces"],
  voice: ["recording", "recordings"],
  article: ["article", "articles"],
  diary: ["page", "pages"],
  cover: ["cover", "covers"],
  card: ["card", "cards"],
  telegram: ["telegram", "telegrams"],
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanTranscriptPreview(value: string): string {
  return value
    .replace(/---\s*Page\s*\d+\s*---/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateCopy(value: string, maxLength = 180): string {
  if (value.length <= maxLength) return value;
  const snippet = value.slice(0, maxLength).trimEnd();
  const lastSpace = snippet.lastIndexOf(" ");
  if (lastSpace <= 48) {
    return `${snippet}...`;
  }
  return `${snippet.slice(0, lastSpace)}...`;
}

export function getPrimaryImage(letter: Letter): LetterImage | undefined {
  return letter.images[0];
}

export function getPrimaryMediaType(letter: Letter): LetterImageType {
  return getPrimaryImage(letter)?.type || (letter.photoDescription ? "photo" : "letter");
}

export function getMediaLabel(type: LetterImageType): string {
  return MEDIA_LABELS[type];
}

export function getLetterPeopleLine(letter: Letter): string | undefined {
  const sender = letter.metadata.sender?.trim();
  const recipient = letter.metadata.recipient?.trim();
  if (sender && recipient) return `${sender} to ${recipient}`;
  return sender || recipient || undefined;
}

export function getLetterPreviewText(letter: Letter): string | undefined {
  const primaryType = getPrimaryMediaType(letter);
  const transcriptFallback = letter.transcript.fullText
    ? cleanTranscriptPreview(letter.transcript.fullText)
    : undefined;
  const extraFallback = letter.extraContentTranscript
    ? cleanTranscriptPreview(letter.extraContentTranscript)
    : undefined;

  const rawCopy = primaryType === "photo"
    ? letter.photoDescription ||
      letter.metadata.description ||
      letter.metadata.hook ||
      extraFallback ||
      transcriptFallback
    : letter.metadata.hook ||
      letter.metadata.description ||
      extraFallback ||
      letter.photoDescription ||
      transcriptFallback;

  if (!rawCopy) return undefined;

  const cleaned = collapseWhitespace(rawCopy);
  if (!cleaned) return undefined;
  return truncateCopy(cleaned);
}

export function getLetterMediaChips(letter: Letter): string[] {
  if (letter.images.length === 0) return [];

  const counts = new Map<LetterImageType, number>();
  for (const image of letter.images) {
    counts.set(image.type, (counts.get(image.type) || 0) + 1);
  }

  const primaryType = getPrimaryMediaType(letter);
  const orderedTypes = Array.from(counts.keys()).sort((a, b) => {
    if (a === primaryType) return -1;
    if (b === primaryType) return 1;
    return a.localeCompare(b);
  });

  return orderedTypes.slice(0, 3).map((type) => {
    const count = counts.get(type) || 0;
    const [singular, plural] = MEDIA_COUNT_LABELS[type];
    return `${count} ${count === 1 ? singular : plural}`;
  });
}
