import { apiPost, apiPut } from "../client";
import type { Letter } from "../../types/Letter";

export interface DescribePhotoResponse {
  letter: Letter;
  describedCount: number;
  photoDescriptionStatus: "EMPTY" | "AI_DRAFT";
}

export async function describePhoto(
  letterId: string,
  photoDescriptionContext: string,
  primarySourceRevision: number,
): Promise<DescribePhotoResponse> {
  // Synchronous AI call — needs more than the default 20s client timeout.
  return apiPost<DescribePhotoResponse>(
    `/admin/letters/${letterId}/describe-photo`,
    { photoDescriptionContext, primarySourceRevision },
    { timeoutMs: 5 * 60 * 1000 },
  );
}

export async function updatePhotoDescription(
  letterId: string,
  photoDescription: string,
  primarySourceRevision: number,
  photoDescriptionContext?: string | null,
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/photo-description`, {
    photoDescription,
    primarySourceRevision,
    ...(photoDescriptionContext !== undefined
      ? { photoDescriptionContext }
      : {}),
  });
}

export async function verifyPhotoDescription(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-photo-description`, {
    primarySourceRevision,
  });
}

export async function unverifyPhotoDescription(
  letterId: string,
  primarySourceRevision: number,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-photo-description`, {
    primarySourceRevision,
  });
}
