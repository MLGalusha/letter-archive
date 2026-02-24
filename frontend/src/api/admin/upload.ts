import { apiPost } from "../client";

export interface UploadResult {
  filename: string;
  letterId: string;
  pageId: string;
  collectionCode: string;
  storagePath: string;
  alreadyExists: boolean;
}

export interface UploadError {
  filename: string;
  error: string;
}

export interface UploadResponse {
  success: number;
  failed: number;
  results: UploadResult[];
  errors?: UploadError[];
}

export async function uploadFiles(files: File[], force = false): Promise<UploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const url = force ? "/admin/uploads?force=true" : "/admin/uploads";
  return apiPost<UploadResponse>(url, formData);
}

export interface CheckDuplicatesResponse {
  duplicates: Record<string, boolean>;
}

export async function checkDuplicates(filenames: string[]): Promise<CheckDuplicatesResponse> {
  return apiPost<CheckDuplicatesResponse>("/admin/uploads/check-duplicates", { filenames });
}
