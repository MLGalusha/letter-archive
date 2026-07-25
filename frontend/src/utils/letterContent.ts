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

export function isPrimaryPhotoType(
  primaryType: LetterImageType | undefined,
): boolean {
  return primaryType === "photo";
}

export function hasPrimaryTranscriptType(
  primaryType: LetterImageType | undefined,
): boolean {
  return primaryType ? PRIMARY_TRANSCRIPT_TYPES.has(primaryType) : false;
}

export function isRelatedExtraType(type: LetterImageType): boolean {
  return RELATED_EXTRA_TYPES.has(type);
}

export function isStandalonePhotoRecord(letter: LetterWithImages): boolean {
  const primaryType = getPrimaryImageType(letter);
  return primaryType === "photo" && letter.images.every((image) => image.type === "photo");
}

export function isPrimaryPhotoRecord(letter: LetterWithImages): boolean {
  return isPrimaryPhotoType(getPrimaryImageType(letter));
}

export function hasPrimaryTranscriptContent(letter: LetterWithImages): boolean {
  return hasPrimaryTranscriptType(getPrimaryImageType(letter));
}

export function hasRelatedExtraContent(letter: LetterWithImages): boolean {
  if (getPrimaryImageType(letter) !== "letter") {
    return false;
  }

  return letter.images.some((image) => isRelatedExtraType(image.type));
}

export function shouldShowPublicTranscript(letter: LetterWithTranscript): boolean {
  if (!hasPrimaryTranscriptContent(letter)) {
    return false;
  }

  return letter.transcript.fullText.trim().length > 0 ||
    letter.transcript.pages.some((p) => p.text.trim().length > 0);
}

export function shouldShowMetadataWorkflow(letter: LetterWithImages): boolean {
  return !isPrimaryPhotoRecord(letter);
}

export function shouldShowPhotoDescriptionWorkflow(letter: LetterWithImages): boolean {
  return isPrimaryPhotoRecord(letter);
}
