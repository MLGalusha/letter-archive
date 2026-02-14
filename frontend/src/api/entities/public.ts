import { apiGet } from "../client";
import type { PublicPersonDetail, PublicPlaceDetail } from "./types";

export async function getPersonPublic(personId: string): Promise<PublicPersonDetail> {
  return apiGet<PublicPersonDetail>(`/persons/${personId}`);
}

export async function getPlacePublic(placeId: string): Promise<PublicPlaceDetail> {
  return apiGet<PublicPlaceDetail>(`/places/${placeId}`);
}
