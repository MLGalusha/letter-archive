import { apiGet, apiPost } from "../client";
import type {
  EmotionalTone,
  Letter,
  RelationshipType,
} from "../../types/Letter";

export type VersionFieldType = "transcript" | "metadata";
export type VersionSource = "ai" | "human";

export type PersistedEmotionalTone =
  | EmotionalTone
  | "neutral"
  | "desperate";

export type PersistedRelationshipType =
  | RelationshipType
  | "fiancé/fiancée"
  | "parent"
  | "child"
  | "grandparent"
  | "grandchild"
  | "aunt/uncle"
  | "nephew/niece"
  | "cousin"
  | "in-law"
  | "business-associate"
  | "employer"
  | "employee";

export interface MetadataVersionSnapshot {
  sender: string | null;
  recipient: string | null;
  extractedDate: string | null;
  locationWritten: string | null;
  hook: string | null;
  summary: string | null;
  emotionalTone: PersistedEmotionalTone | null;
  senderRecipientRelationship: PersistedRelationshipType | null;
  primaryTopics: string[] | null;
}

export type CreateVersionRequest = {
  primarySourceRevision: number;
  source: VersionSource;
} & (
  | {
      fieldType: "transcript";
      content: string;
    }
  | {
      fieldType: "metadata";
      content: MetadataVersionSnapshot;
    }
);

export interface LetterVersion {
  versionNumber: number;
  content: unknown;
  source: VersionSource;
  createdAt: string;
}

export interface VersionHistoryResponse {
  versions: LetterVersion[];
}

export async function getVersionHistory(
  letterId: string,
  fieldType: VersionFieldType,
): Promise<VersionHistoryResponse> {
  return apiGet<VersionHistoryResponse>(`/admin/letters/${letterId}/versions`, { fieldType });
}

export async function createVersion(
  letterId: string,
  request: CreateVersionRequest,
): Promise<{ versionNumber: number; createdAt: string }> {
  return apiPost<{ versionNumber: number; createdAt: string }>(
    `/admin/letters/${letterId}/versions`,
    request,
  );
}

export async function restoreVersion(
  letterId: string,
  versionNumber: number,
  fieldType: VersionFieldType,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(
    `/admin/letters/${letterId}/versions/${versionNumber}/restore?fieldType=${fieldType}`,
    { primarySourceRevision },
  );
}
