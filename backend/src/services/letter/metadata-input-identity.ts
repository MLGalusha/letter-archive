import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ExtractionCorrections } from '../../ai/openai/metadata.js';
import type { ContentStatus, JobStatus } from '../../db/index.js';

export const CONFIRMATION_GUIDANCE_NAME_MAX_LENGTH = 120;
export const CONFIRMATION_INTENT_IDENTITY_VERSION = 1;
export const METADATA_INPUT_IDENTITY_VERSION = 1;
export const DURABLE_METADATA_GUIDANCE_VERSION = 1;

const controlCharacters = /[\u0000-\u001f\u007f-\u009f]/;
const sha256DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const metadataInputIdentitySchema = z.string().regex(/^v1\.[0-9a-f]{64}$/);

const rawGuidanceNameSchema = z
  .string()
  .refine(
    value => !controlCharacters.test(value),
    'Confirmation guidance cannot contain control characters',
  )
  .transform(value => value.normalize('NFC').trim())
  .refine(
    value => value.length <= CONFIRMATION_GUIDANCE_NAME_MAX_LENGTH,
    `Confirmation guidance cannot exceed ${CONFIRMATION_GUIDANCE_NAME_MAX_LENGTH} characters`,
  )
  .transform(value => value || null);

const rawConfirmationGuidanceSchema = z
  .object({
    confirmedSender: rawGuidanceNameSchema.nullish(),
    confirmedRecipient: rawGuidanceNameSchema.nullish(),
  })
  .strict()
  .transform(value => ({
    confirmedSender: value.confirmedSender ?? null,
    confirmedRecipient: value.confirmedRecipient ?? null,
  }));

const canonicalGuidanceNameSchema = z
  .string()
  .min(1)
  .max(CONFIRMATION_GUIDANCE_NAME_MAX_LENGTH)
  .refine(value => !controlCharacters.test(value))
  .refine(value => value === value.normalize('NFC').trim());

const normalizedConfirmationGuidanceSchema = z
  .object({
    confirmedSender: canonicalGuidanceNameSchema.nullable(),
    confirmedRecipient: canonicalGuidanceNameSchema.nullable(),
  })
  .strict();

const metadataInputSourceSchema = z
  .object({
    letterId: z.string().min(1),
    transcriptionText: z.string(),
    collectionCode: z.string(),
    dateRaw: z.string(),
    letterDate: z.string().nullable(),
    extraContentTranscript: z.string().nullable(),
    extraContentStatus: z.enum(['EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED']),
    extraContentJobStatus: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']),
  })
  .strict();

const durableMetadataGuidanceEnvelopeSchema = z
  .object({
    version: z.literal(DURABLE_METADATA_GUIDANCE_VERSION),
    confirmationId: z.string().uuid(),
    metadataInputIdentity: metadataInputIdentitySchema,
    confirmedSender: canonicalGuidanceNameSchema.nullable(),
    confirmedRecipient: canonicalGuidanceNameSchema.nullable(),
  })
  .strict();

const currentGuidanceContextSchema = z
  .object({
    envelope: z.unknown(),
    confirmationId: z.string().uuid().nullable(),
    confirmationSourceRevision: z.number().int().nonnegative().nullable(),
    confirmationTranscriptDigest: sha256DigestSchema.nullable(),
    primarySourceRevision: z.number().int().nonnegative(),
    metadataInput: metadataInputSourceSchema,
  })
  .strict();

export interface NormalizedConfirmationGuidance {
  confirmedSender: string | null;
  confirmedRecipient: string | null;
}

export interface ConfirmationGuidanceInput {
  confirmedSender?: string | null;
  confirmedRecipient?: string | null;
}

export interface ConfirmationIntentIdentityInput {
  letterId: string;
  primarySourceRevision: number;
  transcriptDigest: string;
  guidance?: unknown;
}

export interface MetadataInputIdentitySource {
  letterId: string;
  transcriptionText: string;
  collectionCode: string;
  dateRaw: string;
  letterDate: string | null;
  extraContentTranscript: string | null;
  extraContentStatus: ContentStatus;
  extraContentJobStatus: JobStatus;
}

export interface DurableMetadataGuidanceEnvelope {
  version: typeof DURABLE_METADATA_GUIDANCE_VERSION;
  confirmationId: string;
  metadataInputIdentity: string;
  confirmedSender: string | null;
  confirmedRecipient: string | null;
}

export interface MetadataConfirmationGuidanceSource {
  envelope: unknown;
  confirmationId: string | null;
  confirmationSourceRevision: number | null;
  confirmationTranscriptDigest: string | null;
  primarySourceRevision: number;
  metadataInput: MetadataInputIdentitySource;
}

function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function versionedIdentity(version: number, canonicalValue: unknown): string {
  return `v${version}.${sha256Utf8(JSON.stringify(canonicalValue))}`;
}

/** Exact SHA-256 digest of the transcript's UTF-8 bytes. */
export function transcriptDigest(transcriptionText: string): string {
  return sha256Utf8(z.string().parse(transcriptionText));
}

/** Normalizes reviewer identity guidance into one stable nullable shape. */
export function normalizeConfirmationGuidance(
  guidance: unknown = {},
): NormalizedConfirmationGuidance {
  return rawConfirmationGuidanceSchema.parse(guidance);
}

/**
 * Identifies one confirmation intent independently from mutable processing
 * attempts and from metadata context that may change after confirmation.
 */
export function confirmationIntentIdentity(
  input: ConfirmationIntentIdentityInput,
): string {
  const letterId = z.string().min(1).parse(input.letterId);
  const primarySourceRevision = z.number()
    .int()
    .nonnegative()
    .parse(input.primarySourceRevision);
  const transcriptDigest = sha256DigestSchema.parse(input.transcriptDigest);
  const guidance = normalizeConfirmationGuidance(input.guidance);

  return versionedIdentity(CONFIRMATION_INTENT_IDENTITY_VERSION, [
    'transcript-confirmation-intent',
    CONFIRMATION_INTENT_IDENTITY_VERSION,
    letterId,
    primarySourceRevision,
    transcriptDigest,
    guidance.confirmedSender,
    guidance.confirmedRecipient,
  ]);
}

/**
 * Identifies every persisted value currently sent to basic metadata AI.
 * Attempt, lease, and output state is deliberately absent.
 */
export function metadataInputIdentity(
  source: MetadataInputIdentitySource,
): string {
  const parsed = metadataInputSourceSchema.parse(source);

  return versionedIdentity(METADATA_INPUT_IDENTITY_VERSION, [
    'metadata-input',
    METADATA_INPUT_IDENTITY_VERSION,
    parsed.letterId,
    parsed.transcriptionText,
    parsed.collectionCode,
    parsed.dateRaw,
    parsed.letterDate,
    parsed.extraContentTranscript,
    parsed.extraContentStatus,
    parsed.extraContentJobStatus,
  ]);
}

/** Builds the validated, versioned value stored with queued reviewer guidance. */
export function buildMetadataConfirmationGuidanceEnvelope(input: {
  confirmationId: string;
  metadataInputIdentity: string;
  guidance?: unknown;
}): DurableMetadataGuidanceEnvelope {
  const guidance = normalizeConfirmationGuidance(input.guidance);
  return durableMetadataGuidanceEnvelopeSchema.parse({
    version: DURABLE_METADATA_GUIDANCE_VERSION,
    confirmationId: input.confirmationId,
    metadataInputIdentity: input.metadataInputIdentity,
    ...guidance,
  });
}

/**
 * Resolves persisted guidance only when it is canonical and still bound to the
 * current confirmation, primary source, transcript bytes, and complete AI
 * input. Invalid or stale database values are ignored rather than promoted to
 * human authority.
 */
export function resolveMetadataConfirmationGuidance(
  source: MetadataConfirmationGuidanceSource,
): ExtractionCorrections | undefined {
  const envelopeResult = durableMetadataGuidanceEnvelopeSchema.safeParse(
    source.envelope,
  );
  const contextResult = currentGuidanceContextSchema.safeParse(source);
  if (!envelopeResult.success || !contextResult.success) return undefined;

  const envelope = envelopeResult.data;
  const context = contextResult.data;
  if (
    context.confirmationId === null
    || context.confirmationSourceRevision === null
    || context.confirmationTranscriptDigest === null
    || envelope.confirmationId !== context.confirmationId
    || context.confirmationSourceRevision !== context.primarySourceRevision
    || context.confirmationTranscriptDigest
      !== transcriptDigest(context.metadataInput.transcriptionText)
    || envelope.metadataInputIdentity
      !== metadataInputIdentity(context.metadataInput)
  ) {
    return undefined;
  }

  const corrections: ExtractionCorrections = {};
  if (envelope.confirmedSender !== null) {
    corrections.confirmedSender = envelope.confirmedSender;
  }
  if (envelope.confirmedRecipient !== null) {
    corrections.confirmedRecipient = envelope.confirmedRecipient;
  }
  return Object.keys(corrections).length > 0 ? corrections : undefined;
}

export function isNormalizedConfirmationGuidance(
  value: unknown,
): value is NormalizedConfirmationGuidance {
  return normalizedConfirmationGuidanceSchema.safeParse(value).success;
}
