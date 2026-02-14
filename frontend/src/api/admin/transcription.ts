import { apiPost } from "../client";
import type { Letter } from "../../types/Letter";

export interface TranscribeLetterResponse {
  letter: Letter;
  transcribed: {
    pageCount: number;
    textLength: number;
  };
}

export interface RegenerateTranscriptionResponse {
  letter: Letter;
  regenerated: {
    mainTranscript: boolean;
    extras: boolean;
    extrasCount: number;
  };
}

export async function transcribeLetter(letterId: string): Promise<TranscribeLetterResponse> {
  return apiPost<TranscribeLetterResponse>(`/admin/letters/${letterId}/transcribe-letter`);
}

export async function regenerateTranscription(
  letterId: string,
  includeExtras = true,
): Promise<RegenerateTranscriptionResponse> {
  const url = includeExtras
    ? `/admin/letters/${letterId}/regenerate-transcription?includeExtras=true`
    : `/admin/letters/${letterId}/regenerate-transcription`;
  return apiPost<RegenerateTranscriptionResponse>(url);
}
