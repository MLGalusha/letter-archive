import { apiPost, apiPut, apiPatch, API_BASE_URL, getAuthHeaders } from "../client";
import type { Letter, LineSegment, OcrWordBox } from "../../types/Letter";

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

export type DetectLinesResult = { lineSegments: LineSegment[]; ocrWordBoxes: OcrWordBox[] | null };

/**
 * Detect page lines with SSE progress streaming.
 * Calls onProgress for each pipeline step, then returns the final result.
 */
export async function detectPageLines(
  pageId: string,
  onProgress?: (label: string) => void,
): Promise<DetectLinesResult> {
  const response = await fetch(`${API_BASE_URL}/admin/letters/pages/${pageId}/detect-lines`, {
    method: 'POST',
    credentials: 'include',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Line detection failed');
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: DetectLinesResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse SSE messages (split on double newline)
    const parts = buffer.split('\n\n');
    buffer = parts.pop()!; // keep incomplete tail

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data: ')) continue;

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(line.slice(6));
      } catch {
        console.warn('[detectPageLines] Malformed SSE data:', line);
        continue;
      }
      if (data.type === 'progress') {
        onProgress?.(data.label as string);
      } else if (data.type === 'result') {
        result = {
          lineSegments: data.lineSegments as LineSegment[],
          ocrWordBoxes: data.ocrWordBoxes as OcrWordBox[] | null,
        };
      } else if (data.type === 'error') {
        throw new Error(data.message as string);
      }
    }
  }

  if (!result) {
    throw new Error('No result received from line detection');
  }

  return result;
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

export async function toggleLetterFlag(letterId: string, flagged: boolean): Promise<Letter> {
  return apiPatch<Letter>(`/admin/letters/${letterId}/flag`, { flagged });
}

export async function updateNoteStatus(letterId: string, noteId: string, status: 'resolved' | 'dismissed'): Promise<Letter> {
  return apiPatch<Letter>(`/admin/letters/${letterId}/notes/${noteId}`, { status });
}

export async function addNote(letterId: string, note: { content: string; category: string; priority: string }): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/notes`, note);
}
