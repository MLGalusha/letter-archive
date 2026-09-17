import { apiGet } from "../client";
import type { PublicPersonDetail, PublicPlaceDetail } from "./types";

export async function getPersonPublic(personId: string, signal?: AbortSignal): Promise<PublicPersonDetail> {
  return apiGet<PublicPersonDetail>(`/persons/${personId}`, undefined, signal);
}

export async function getPlacePublic(placeId: string, signal?: AbortSignal): Promise<PublicPlaceDetail> {
  return apiGet<PublicPlaceDetail>(`/places/${placeId}`, undefined, signal);
}
