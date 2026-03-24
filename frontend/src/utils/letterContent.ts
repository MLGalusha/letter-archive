import type { Letter, LetterImageType } from "../types/Letter";

const PRIMARY_TRANSCRIPT_TYPES = new Set<LetterImageType>([
  "letter",
  "telegram",
  "cover",
  "ephemera",
  "card",
  "article",
  "diary",
]);

const RELATED_EXTRA_TYPES = new Set<LetterImageType>([
  "telegram",
  "cover",
  "ephemera",
]);

type LetterWithImages = Pick<Letter, "images">;
type LetterWithTranscript = Pick<Letter, "images" | "transcript">;

export function getPrimaryImageType(letter: LetterWithImages): LetterImageType | undefined {
  return letter.images[0]?.type;
}

export function hasPrimaryTranscriptContent(letter: LetterWithImages): boolean {
  const primaryType = getPrimaryImageType(letter);
  return primaryType ? PRIMARY_TRANSCRIPT_TYPES.has(primaryType) : false;
}

export function hasRelatedExtraContent(letter: LetterWithImages): boolean {
  if (getPrimaryImageType(letter) !== "letter") {
    return false;
  }

  return letter.images.some((image) => RELATED_EXTRA_TYPES.has(image.type));
}

export function shouldShowPublicTranscript(letter: LetterWithTranscript): boolean {
  if (!hasPrimaryTranscriptContent(letter)) {
    return false;
  }

  return (
    letter.images.some((image) => image.type === "letter") ||
    letter.transcript.fullText.trim().length > 0
  );
}
