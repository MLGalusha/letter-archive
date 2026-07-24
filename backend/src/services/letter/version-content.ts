import {
  PERSISTED_EMOTIONAL_TONE_VALUES,
  PERSISTED_RELATIONSHIP_TYPE_VALUES,
  type PersistedEmotionalTone,
  type PersistedRelationshipType,
} from '../../constants/metadata-values.js';

export const EMOTIONAL_TONE_VALUES = PERSISTED_EMOTIONAL_TONE_VALUES;
export const RELATIONSHIP_TYPE_VALUES = PERSISTED_RELATIONSHIP_TYPE_VALUES;

export const METADATA_VERSION_FIELDS = [
  'sender',
  'recipient',
  'locationWritten',
  'hook',
  'summary',
  'extractedDate',
  'emotionalTone',
  'senderRecipientRelationship',
  'primaryTopics',
] as const;

export type MetadataVersionField = typeof METADATA_VERSION_FIELDS[number];

export interface TranscriptVersionContent {
  text: string;
}

export type TranscriptVersionCandidateContent =
  | string
  | TranscriptVersionContent;

/**
 * The canonical snapshot written for every new metadata version.
 *
 * `primaryTopics` intentionally accepts any strings already present in the
 * database. The current AI vocabulary must not make historical rows
 * unrestorable, and array order is part of the snapshot.
 */
export interface MetadataVersionContent {
  sender: string | null;
  recipient: string | null;
  locationWritten: string | null;
  hook: string | null;
  summary: string | null;
  extractedDate: string | null;
  emotionalTone: PersistedEmotionalTone | null;
  senderRecipientRelationship: PersistedRelationshipType | null;
  primaryTopics: string[] | null;
}

type AtLeastOne<T> = {
  [Field in keyof T]-?: Required<Pick<T, Field>>
    & Partial<Omit<T, Field>>;
}[keyof T];

/**
 * Request candidates and historical stored snapshots may contain any non-empty
 * subset of recognized metadata fields. A successful decode guarantees at
 * least one field and retains the distinction between absent and explicit null.
 */
export type MetadataVersionCandidateContent = AtLeastOne<MetadataVersionContent>;

export type VersionContentDecodeResult<Content> =
  | { ok: true; content: Content }
  | { ok: false };

const INVALID_CONTENT = { ok: false } as const;

const NULLABLE_STRING_FIELDS = [
  'sender',
  'recipient',
  'locationWritten',
  'hook',
  'summary',
] as const;

const EMOTIONAL_TONE_SET = new Set<string>(EMOTIONAL_TONE_VALUES);
const RELATIONSHIP_TYPE_SET = new Set<string>(RELATIONSHIP_TYPE_VALUES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value);
}

function isEmotionalTone(value: unknown): value is PersistedEmotionalTone {
  return typeof value === 'string' && EMOTIONAL_TONE_SET.has(value);
}

function isRelationshipType(value: unknown): value is PersistedRelationshipType {
  return typeof value === 'string' && RELATIONSHIP_TYPE_SET.has(value);
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

export function decodeTranscriptVersionContent(
  value: unknown,
): VersionContentDecodeResult<TranscriptVersionContent> {
  if (typeof value === 'string') {
    return { ok: true, content: { text: value } };
  }
  if (!isRecord(value) || typeof value.text !== 'string') {
    return INVALID_CONTENT;
  }
  return { ok: true, content: { text: value.text } };
}

export function decodeMetadataVersionContent(
  value: unknown,
): VersionContentDecodeResult<MetadataVersionCandidateContent> {
  if (!isRecord(value)) return INVALID_CONTENT;

  let hasRecognizedField = false;
  const content: Partial<MetadataVersionContent> = {};

  for (const field of NULLABLE_STRING_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    hasRecognizedField = true;

    const fieldValue = value[field];
    if (fieldValue !== null && typeof fieldValue !== 'string') {
      return INVALID_CONTENT;
    }
    content[field] = fieldValue;
  }

  if (Object.hasOwn(value, 'extractedDate')) {
    hasRecognizedField = true;
    const extractedDate = value.extractedDate;
    if (extractedDate !== null && !isValidIsoDate(extractedDate)) {
      return INVALID_CONTENT;
    }
    content.extractedDate = extractedDate;
  }

  if (Object.hasOwn(value, 'emotionalTone')) {
    hasRecognizedField = true;
    const emotionalTone = value.emotionalTone;
    if (emotionalTone !== null && !isEmotionalTone(emotionalTone)) {
      return INVALID_CONTENT;
    }
    content.emotionalTone = emotionalTone;
  }

  if (Object.hasOwn(value, 'senderRecipientRelationship')) {
    hasRecognizedField = true;
    const relationship = value.senderRecipientRelationship;
    if (relationship !== null && !isRelationshipType(relationship)) {
      return INVALID_CONTENT;
    }
    content.senderRecipientRelationship = relationship;
  }

  if (Object.hasOwn(value, 'primaryTopics')) {
    hasRecognizedField = true;
    const primaryTopics = value.primaryTopics;
    if (primaryTopics === null) {
      content.primaryTopics = null;
    } else {
      if (!Array.isArray(primaryTopics)) return INVALID_CONTENT;

      const topics: string[] = [];
      for (const topic of primaryTopics) {
        if (typeof topic !== 'string') return INVALID_CONTENT;
        topics.push(topic);
      }
      content.primaryTopics = topics;
    }
  }

  if (!hasRecognizedField) return INVALID_CONTENT;
  return {
    ok: true,
    content: content as MetadataVersionCandidateContent,
  };
}

export function canonicalizeTranscriptVersionContent(
  candidate: TranscriptVersionCandidateContent,
): TranscriptVersionContent {
  return {
    text: typeof candidate === 'string' ? candidate : candidate.text,
  };
}

export function canonicalizeMetadataVersionContent(
  current: MetadataVersionContent,
): MetadataVersionContent {
  return {
    sender: current.sender,
    recipient: current.recipient,
    locationWritten: current.locationWritten,
    hook: current.hook,
    summary: current.summary,
    extractedDate: current.extractedDate,
    emotionalTone: current.emotionalTone,
    senderRecipientRelationship: current.senderRecipientRelationship,
    primaryTopics: current.primaryTopics === null
      ? null
      : [...current.primaryTopics],
  };
}

export function transcriptVersionMatchesCurrentContent(
  current: string | null,
  candidate: TranscriptVersionCandidateContent,
): boolean {
  return current === canonicalizeTranscriptVersionContent(candidate).text;
}

function orderedTopicsMatch(
  current: string[] | null,
  candidate: string[] | null,
): boolean {
  if (current === null || candidate === null) return current === candidate;
  return current.length === candidate.length
    && current.every((topic, index) => topic === candidate[index]);
}

export function metadataVersionMatchesCurrentContent(
  current: MetadataVersionContent,
  candidate: MetadataVersionCandidateContent,
): boolean {
  for (const field of NULLABLE_STRING_FIELDS) {
    if (Object.hasOwn(candidate, field) && candidate[field] !== current[field]) {
      return false;
    }
  }

  if (
    Object.hasOwn(candidate, 'extractedDate')
    && candidate.extractedDate !== current.extractedDate
  ) {
    return false;
  }
  if (
    Object.hasOwn(candidate, 'emotionalTone')
    && candidate.emotionalTone !== current.emotionalTone
  ) {
    return false;
  }
  if (
    Object.hasOwn(candidate, 'senderRecipientRelationship')
    && candidate.senderRecipientRelationship !== current.senderRecipientRelationship
  ) {
    return false;
  }
  if (Object.hasOwn(candidate, 'primaryTopics')) {
    const candidateTopics = candidate.primaryTopics;
    if (
      candidateTopics === undefined
      || !orderedTopicsMatch(current.primaryTopics, candidateTopics)
    ) {
      return false;
    }
  }

  return true;
}
