import { apiGet, apiPost, apiPut, apiPatch } from "../client";
import type {
  EmotionalTone,
  Letter,
  LineSegment,
  RelationshipType,
  SegmentTrustState,
  StructuredNoteDraft,
} from "../../types/Letter";

export interface UpdateLetterData {
  primarySourceRevision: number;
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  extractedDate?: string | null;
  emotionalTone?: EmotionalTone | null;
  senderRecipientRelationship?: RelationshipType | null;
  primaryTopics?: string[] | null;
  tags?: string[] | null;
  visibility?: "PUBLISHED" | "HIDDEN";
  transcriptPublished?: boolean;
  metadataPublished?: boolean;
  notes?: string | null;
  readingText?: string | null;
}

export interface RetagMetadataChange {
  primarySourceRevision: number;
  field: "sender" | "recipient" | "both";
  oldSender?: string | null;
  newSender?: string | null;
  oldRecipient?: string | null;
  newRecipient?: string | null;
}

export interface PageSourceExpectation {
  primarySourceRevision: number;
  sourceChecksum: string | null;
}

export interface PageGeometryExpectation extends PageSourceExpectation {
  expectedGeometryRevision: number;
  expectedLineSegmentsChecksumSha256: string;
}

export interface PageGeometryApprovalExpectation extends PageSourceExpectation {
  expectedGeometryRevision: number;
  expectedGeometryChecksumSha256: string;
}

export interface PageGeometryReviewState {
  trustState: SegmentTrustState;
  approvedGeometryRevision: number | null;
  approvedGeometryChecksumSha256: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface PageGeometryEnvelope {
  lineSegments: LineSegment[];
  geometryRevision: number;
  geometryChecksumSha256: string;
  lineSegmentsChecksumSha256: string;
  reviewState: PageGeometryReviewState;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isPageGeometryReviewState(
  value: unknown,
): value is PageGeometryReviewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const review = value as Partial<PageGeometryReviewState>;
  if (review.trustState === 'unverified') {
    return (
      review.approvedGeometryRevision === null
      && review.approvedGeometryChecksumSha256 === null
      && review.approvedBy === null
      && review.approvedAt === null
    );
  }
  return (
    review.trustState === 'trusted'
    && Number.isInteger(review.approvedGeometryRevision)
    && (review.approvedGeometryRevision ?? -1) >= 0
    && SHA256_PATTERN.test(review.approvedGeometryChecksumSha256 ?? '')
    && typeof review.approvedBy === 'string'
    && review.approvedBy.length > 0
    && typeof review.approvedAt === 'string'
    && Number.isFinite(Date.parse(review.approvedAt))
  );
}

function requirePageGeometryEnvelope(value: unknown): PageGeometryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The page geometry response was invalid');
  }
  const result = value as Partial<PageGeometryEnvelope>;
  if (
    !Array.isArray(result.lineSegments)
    || !Number.isInteger(result.geometryRevision)
    || (result.geometryRevision ?? -1) < 0
    || !SHA256_PATTERN.test(result.geometryChecksumSha256 ?? '')
    || !SHA256_PATTERN.test(result.lineSegmentsChecksumSha256 ?? '')
    || !isPageGeometryReviewState(result.reviewState)
  ) {
    throw new Error('The page geometry response was incomplete');
  }
  return result as PageGeometryEnvelope;
}

export type MetadataDisposition =
  | 'queued'
  | 'already_running'
  | 'already_available'
  | 'failed'
  | 'not_applicable';

export interface TranscriptConfirmationReceipt {
  confirmationId: string;
  confirmedAt: string;
  confirmedBy: string | null;
  transcriptSource: {
    primarySourceRevision: number;
    transcriptDigest: string;
  };
  metadataInputIdentity: string | null;
  intentIdentity: string;
  metadataDisposition: MetadataDisposition;
}

export interface TranscriptConfirmationResponse {
  receipt: TranscriptConfirmationReceipt;
  letter?: Letter;
}

export async function updateLetter(letterId: string, data: UpdateLetterData): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, data);
}

export async function publishLetter(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, {
    primarySourceRevision,
    visibility: "PUBLISHED",
  });
}

export async function hideLetter(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, {
    primarySourceRevision,
    visibility: "HIDDEN",
  });
}

export async function processLetter(
  letterId: string,
  primarySourceRevision: number,
): Promise<{ message: string; letterId: string }> {
  return apiPost<{ message: string; letterId: string }>(
    `/admin/letters/${letterId}/process`,
    { primarySourceRevision },
  );
}

export async function confirmTranscript(
  letterId: string,
  primarySourceRevision: number,
  transcriptDigest: string,
  options?: { confirmedSender?: string; confirmedRecipient?: string },
): Promise<TranscriptConfirmationResponse> {
  return apiPost<TranscriptConfirmationResponse>(
    `/admin/letters/${letterId}/confirm-transcript`,
    {
      ...options,
      primarySourceRevision,
      transcriptDigest,
    },
  );
}

export async function regenerateMetadata(
  letterId: string,
  primarySourceRevision: number,
  options?: { confirmedSender?: string; confirmedRecipient?: string },
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-metadata`, {
    ...options,
    primarySourceRevision,
  });
}

export async function regenerateEntities(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-entities`, {
    primarySourceRevision,
  });
}

export async function generateReadingView(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/generate-reading-view`, {
    primarySourceRevision,
  });
}

export async function verifyTranscript(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-transcript`, {
    primarySourceRevision,
  });
}

export async function unverifyTranscript(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-transcript`, {
    primarySourceRevision,
  });
}

export async function verifyMetadata(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-metadata`, {
    primarySourceRevision,
  });
}

export async function unverifyMetadata(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-metadata`, {
    primarySourceRevision,
  });
}

export async function savePageLineSegments(
  pageId: string,
  segments: LineSegment[],
  expected: PageGeometryExpectation,
): Promise<PageGeometryEnvelope> {
  const result = await apiPatch<unknown>(`/admin/letters/pages/${pageId}/line-segments`, {
    lineSegments: segments,
    ...expected,
  });
  return requirePageGeometryEnvelope(result);
}

/** Fetch the current editable geometry together with its immutable revision identity. */
export async function getPageGeometry(pageId: string): Promise<PageGeometryEnvelope> {
  const result = await apiGet<unknown>(
    `/admin/letters/pages/${pageId}/line-segments`,
  );
  return requirePageGeometryEnvelope(result);
}

/** Fetch existing line segments from the database for a page. */
export async function getPageLineSegments(pageId: string): Promise<LineSegment[]> {
  return (await getPageGeometry(pageId)).lineSegments;
}

export async function reExtractLetter(
  letterId: string,
  options: {
    primarySourceRevision: number;
    confirmedSender?: string;
    confirmedRecipient?: string;
    mode: 'full' | 'metadata_only' | 'entities_only';
  }
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/re-extract`, options);
}

export async function updateIdentity(
  letterId: string,
  data: {
    primarySourceRevision: number;
    expectedSender?: string | null;
    expectedRecipient?: string | null;
    sender?: string;
    recipient?: string;
  },
): Promise<Letter> {
  return apiPatch<Letter>(`/admin/letters/${letterId}/identity`, data);
}

export async function retagMetadata(
  letterId: string,
  change: RetagMetadataChange,
  signal?: AbortSignal,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/retag`, change, signal);
}

export async function toggleLetterFlag(letterId: string, flagged: boolean): Promise<Letter> {
  return apiPatch<Letter>(`/admin/letters/${letterId}/flag`, { flagged });
}

export async function updateNoteStatus(
  letterId: string,
  primarySourceRevision: number,
  noteId: string,
  status: 'resolved' | 'dismissed',
): Promise<Letter> {
  return apiPatch<Letter>(`/admin/letters/${letterId}/notes/${noteId}`, {
    primarySourceRevision,
    status,
  });
}

export async function addNote(
  letterId: string,
  primarySourceRevision: number,
  note: StructuredNoteDraft,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/notes`, {
    ...note,
    primarySourceRevision,
  });
}

/** Update segment trust state for a single page. */
export async function updatePageSegmentTrust(
  pageId: string,
  trustState: SegmentTrustState,
  expected: PageGeometryApprovalExpectation,
): Promise<PageGeometryEnvelope> {
  const result = await apiPatch<unknown>(`/admin/letters/pages/${pageId}/segment-trust`, {
    trustState,
    ...expected,
  });
  return requirePageGeometryEnvelope(result);
}

/** Update segment trust state for all pages of a letter. */
export async function updateLetterSegmentTrust(
  letterId: string,
  trustState: SegmentTrustState,
  primarySourceRevision: number,
  pages: Array<{
    pageId: string;
    sourceChecksum: string | null;
    expectedGeometryRevision: number;
    expectedGeometryChecksumSha256: string;
  }>,
): Promise<void> {
  await apiPatch(`/admin/letters/${letterId}/segment-trust`, {
    trustState,
    primarySourceRevision,
    pages,
  });
}
