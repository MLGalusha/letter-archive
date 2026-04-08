import { apiPost } from "../client";
import type { Letter } from "../../types/Letter";

// AI transcription routes call OpenAI synchronously and routinely take longer
// than the default 20s client timeout. Give them 5 minutes before the client
// gives up so the user doesn't see "signal timed out" while the request is
// still in flight on the server.
const AI_TIMEOUT_MS = 5 * 60 * 1000;

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
  return apiPost<TranscribeLetterResponse>(
    `/admin/letters/${letterId}/transcribe-letter`,
    undefined,
    { timeoutMs: AI_TIMEOUT_MS },
  );
}

export async function regenerateTranscription(
  letterId: string,
  includeExtras = true,
): Promise<RegenerateTranscriptionResponse> {
  const url = includeExtras
    ? `/admin/letters/${letterId}/regenerate-transcription?includeExtras=true`
    : `/admin/letters/${letterId}/regenerate-transcription`;
  return apiPost<RegenerateTranscriptionResponse>(url, undefined, {
    timeoutMs: AI_TIMEOUT_MS,
  });
}
