import { apiPost } from "../client";

export type DuplicateReason = "duplicate_content";

export interface UploadResult {
  filename: string;
  letterId: string;
  pageId: string;
  collectionCode: string;
  storagePath: string;
  primarySourceRevision: number;
  alreadyExists: boolean;
  outcome: "created" | "replaced" | "unchanged";
  changed: boolean;
  duplicateReason?: DuplicateReason;
}

export interface UploadError {
  filename: string;
  error: string;
  code?: string;
}

export interface UploadSourceExpectation {
  pageId: string;
  primarySourceRevision: number;
  storagePath: string;
  checksumSha256: string | null;
}

export interface UploadResponse {
  success: number;
  failed: number;
  results: UploadResult[];
  errors?: UploadError[];
  summary: {
    accepted: number;
    failed: number;
    changed: number;
    unchanged: number;
    created: number;
    replaced: number;
    affectedLetters: number;
  };
}

export async function uploadFiles(
  files: File[],
  force = false,
  sourceExpectations?: Record<string, UploadSourceExpectation>,
): Promise<UploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  if (force && sourceExpectations) {
    formData.append("sourceExpectations", JSON.stringify(sourceExpectations));
  }
  const url = force ? "/admin/uploads?force=true" : "/admin/uploads";
  return apiPost<UploadResponse>(url, formData);
}

export interface CheckDuplicatesResponse {
  duplicates: Record<string, boolean>;
  sourceExpectations: Record<string, UploadSourceExpectation | null>;
  contentDuplicates: Record<string, boolean>;
}

export async function checkDuplicates(
  filenames: string[],
  hashes?: Record<string, string>,
): Promise<CheckDuplicatesResponse> {
  return apiPost<CheckDuplicatesResponse>(
    "/admin/uploads/check-duplicates",
    hashes ? { filenames, hashes } : { filenames },
  );
}
