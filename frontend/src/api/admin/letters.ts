import { apiGet, apiPost, apiPut, apiPatch } from "../client";
import type { Letter, LineSegment } from "../../types/Letter";

export interface UpdateLetterData {
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  extractedDate?: string | null;
  tags?: string[] | null;
  visibility?: "PUBLISHED" | "HIDDEN";
  transcriptPublished?: boolean;
  metadataPublished?: boolean;
  notes?: string | null;
  readingText?: string | null;
}

export interface RetagMetadataChange {
  field: "sender" | "recipient" | "both";
  oldSender?: string | null;
  newSender?: string | null;
  oldRecipient?: string | null;
  newRecipient?: string | null;
}

export async function updateLetter(letterId: string, data: UpdateLetterData): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, data);
}

export async function publishLetter(letterId: string): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, { visibility: "PUBLISHED" });
}

export async function hideLetter(letterId: string): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}`, { visibility: "HIDDEN" });
}

export async function processLetter(letterId: string): Promise<{ message: string; letterId: string }> {
  return apiPost<{ message: string; letterId: string }>(`/admin/letters/${letterId}/process`);
}

export async function confirmTranscript(
  letterId: string,
  options?: { confirmedSender?: string; confirmedRecipient?: string },
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/confirm-transcript`, options ?? {});
}

export async function regenerateMetadata(
  letterId: string,
  options?: { confirmedSender?: string; confirmedRecipient?: string },
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-metadata`, options ?? {});
}

export async function regenerateEntities(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-entities`);
}

export async function generateReadingView(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/generate-reading-view`);
}

export async function verifyTranscript(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-transcript`);
}

export async function unverifyTranscript(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-transcript`);
}

export async function verifyMetadata(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-metadata`);
}

export async function unverifyMetadata(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-metadata`);
}

export async function savePageLineSegments(pageId: string, segments: LineSegment[]): Promise<void> {
  await apiPatch(`/admin/letters/pages/${pageId}/line-segments`, { lineSegments: segments });
}

/** Fetch existing line segments from the database for a page. */
export async function getPageLineSegments(pageId: string): Promise<LineSegment[]> {
  const result = await apiGet<{ lineSegments: LineSegment[] }>(`/admin/letters/pages/${pageId}/line-segments`);
  return result.lineSegments ?? [];
}

export async function reExtractLetter(
  letterId: string,
  options: {
    confirmedSender?: string;
    confirmedRecipient?: string;
    mode: 'full' | 'metadata_only' | 'entities_only';
  }
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/re-extract`, options);
}

export async function updateIdentity(letterId: string, data: { sender?: string; recipient?: string }): Promise<Letter> {
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

export async function updateNoteStatus(letterId: string, noteId: string, status: 'resolved' | 'dismissed'): Promise<Letter> {
  return apiPatch<Letter>(`/admin/letters/${letterId}/notes/${noteId}`, { status });
}

export async function addNote(letterId: string, note: { content: string; category: string; priority: string }): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/notes`, note);
}
