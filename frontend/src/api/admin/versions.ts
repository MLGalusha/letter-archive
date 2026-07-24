import { apiGet, apiPost } from "../client";
import type { Letter } from "../../types/Letter";

export interface LetterVersion {
  versionNumber: number;
  content: Record<string, unknown>;
  source: "ai" | "human";
  createdAt: string;
}

export interface VersionHistoryResponse {
  versions: LetterVersion[];
}

export async function getVersionHistory(
  letterId: string,
  fieldType: "transcript" | "metadata",
): Promise<VersionHistoryResponse> {
  return apiGet<VersionHistoryResponse>(`/admin/letters/${letterId}/versions`, { fieldType });
}

export async function createVersion(
  letterId: string,
  primarySourceRevision: number,
  fieldType: "transcript" | "metadata",
  content: string | Record<string, unknown>,
  source: "ai" | "human" = "human",
): Promise<{ versionNumber: number; createdAt: string }> {
  return apiPost<{ versionNumber: number; createdAt: string }>(
    `/admin/letters/${letterId}/versions`,
    { primarySourceRevision, fieldType, content, source },
  );
}

export async function restoreVersion(
  letterId: string,
  versionNumber: number,
  fieldType: "transcript" | "metadata",
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(
    `/admin/letters/${letterId}/versions/${versionNumber}/restore?fieldType=${fieldType}`,
    { primarySourceRevision },
  );
}
