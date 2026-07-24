import type { MetadataVersionSnapshot } from "../../../api/admin/versions";
import type {
  EmotionalTone,
  Letter,
  RelationshipType,
} from "../../../types/Letter";

export type MetadataVersionPatch = Partial<Omit<
  MetadataVersionSnapshot,
  "emotionalTone" | "senderRecipientRelationship"
>> & {
  emotionalTone?: EmotionalTone | null;
  senderRecipientRelationship?: RelationshipType | null;
};

const METADATA_VERSION_FIELDS = {
  sender: true,
  recipient: true,
  extractedDate: true,
  locationWritten: true,
  hook: true,
  summary: true,
  emotionalTone: true,
  senderRecipientRelationship: true,
  primaryTopics: true,
} as const satisfies Record<keyof MetadataVersionSnapshot, true>;

const metadataVersionFields = Object.keys(
  METADATA_VERSION_FIELDS,
) as Array<keyof MetadataVersionSnapshot>;

function patchOrAuthoritative<T>(
  patchValue: T | undefined,
  authoritativeValue: T | undefined,
): T | null {
  return patchValue !== undefined
    ? patchValue
    : authoritativeValue ?? null;
}

export function hasMetadataVersionPatch(
  patch: MetadataVersionPatch,
): boolean {
  return metadataVersionFields.some(
    (field) => patch[field] !== undefined,
  );
}

export function createMetadataVersionSnapshot(
  patch: MetadataVersionPatch,
  authoritativeLetter: Pick<Letter, "metadata">,
): MetadataVersionSnapshot {
  const primaryTopics = patch.primaryTopics !== undefined
    ? patch.primaryTopics
    : authoritativeLetter.metadata.primaryTopics;

  return {
    sender: patchOrAuthoritative(
      patch.sender,
      authoritativeLetter.metadata.sender,
    ),
    recipient: patchOrAuthoritative(
      patch.recipient,
      authoritativeLetter.metadata.recipient,
    ),
    extractedDate: patchOrAuthoritative(
      patch.extractedDate,
      authoritativeLetter.metadata.extractedDate,
    ),
    locationWritten: patchOrAuthoritative(
      patch.locationWritten,
      authoritativeLetter.metadata.location,
    ),
    hook: patchOrAuthoritative(
      patch.hook,
      authoritativeLetter.metadata.hook,
    ),
    summary: patchOrAuthoritative(
      patch.summary,
      authoritativeLetter.metadata.description,
    ),
    emotionalTone: patchOrAuthoritative(
      patch.emotionalTone,
      authoritativeLetter.metadata.emotionalTone,
    ),
    senderRecipientRelationship: patchOrAuthoritative(
      patch.senderRecipientRelationship,
      authoritativeLetter.metadata.senderRecipientRelationship,
    ),
    primaryTopics: primaryTopics === undefined || primaryTopics === null
      ? null
      : [...primaryTopics],
  };
}
