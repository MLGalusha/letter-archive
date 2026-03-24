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
): Promise<DescribePhotoResponse> {
  return apiPost<DescribePhotoResponse>(`/admin/letters/${letterId}/describe-photo`, {
    photoDescriptionContext,
  });
}

export async function updatePhotoDescription(
  letterId: string,
  photoDescription: string,
  photoDescriptionContext?: string | null,
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/photo-description`, {
    photoDescription,
    ...(photoDescriptionContext !== undefined
      ? { photoDescriptionContext }
      : {}),
  });
}

export async function verifyPhotoDescription(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/verify-photo-description`);
}

export async function unverifyPhotoDescription(letterId: string): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/unverify-photo-description`);
}
