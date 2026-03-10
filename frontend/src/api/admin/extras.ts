import { apiPost, apiPut } from "../client";
import type { Letter } from "../../types/Letter";

export interface TranscribeExtrasResponse {
  letter: Letter;
  transcribedCount: number;
  extraContentStatus: "EMPTY" | "AI_DRAFT";
}

export async function transcribeExtras(letterId: string): Promise<TranscribeExtrasResponse> {
  return apiPost<TranscribeExtrasResponse>(`/admin/letters/${letterId}/transcribe-extras`);
}

export async function updateExtraContent(
  letterId: string,
  extraContentTranscript: string,
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/extra-content`, {
    extraContent: extraContentTranscript,
  });
}

export async function verifyExtraContent(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-extra-content`);
}

export async function unverifyExtraContent(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-extra-content`);
}

export async function updateAiNotes(letterId: string, aiNotes: string): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/ai-notes`, { aiNotes });
}
