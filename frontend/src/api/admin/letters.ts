import { apiPost, apiPut } from "../client";
import type { Letter } from "../../types/Letter";

export interface UpdateLetterData {
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  extractedDate?: string | null;
  extractedDateConfidence?: "exact" | "unknown" | "inferred" | null;
  tags?: string[] | null;
  visibility?: "PUBLISHED" | "HIDDEN";
  notes?: string | null;
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

export async function confirmTranscript(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/confirm-transcript`);
}

export async function regenerateMetadata(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-metadata`);
}

export async function regenerateEntities(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/regenerate-entities`);
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
