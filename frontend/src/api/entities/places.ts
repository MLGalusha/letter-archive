import { apiGet, apiPost, apiPut } from "../client";
import type {
  CanonicalPlace,
  EntityMatch,
  LetterForEntity,
  PlaceMergeDetails,
  PlaceWithCount,
} from "./types";
import type { PlaceType } from "../../types/Letter";

export async function getAllPlaces(): Promise<{ places: PlaceWithCount[] }> {
  return apiGet<{ places: PlaceWithCount[] }>("/admin/entities/places");
}

export async function searchPlaces(query: string): Promise<{ matches: EntityMatch[] }> {
  return apiGet<{ matches: EntityMatch[] }>("/admin/entities/places/search", { q: query });
}

export async function getPlaceById(placeId: string): Promise<{
  place: CanonicalPlace;
  letters: LetterForEntity[];
}> {
  return apiGet<{ place: CanonicalPlace; letters: LetterForEntity[] }>(`/admin/entities/places/${placeId}`);
}

export async function createPlace(data: {
  canonicalName: string;
  aliases?: string[];
  placeType?: PlaceType;
  notes?: string;
}): Promise<{ place: CanonicalPlace }> {
  return apiPost<{ place: CanonicalPlace }>("/admin/entities/places", data);
}

export async function updatePlace(
  placeId: string,
  data: {
    canonicalName?: string;
    aliases?: string[];
    placeType?: PlaceType | null;
    notes?: string | null;
  },
): Promise<{ place: CanonicalPlace }> {
  return apiPut<{ place: CanonicalPlace }>(`/admin/entities/places/${placeId}`, data);
}

export async function mergePlaces(
  keepId: string,
  mergeId: string,
): Promise<{ place: CanonicalPlace; message: string }> {
  return apiPost<{ place: CanonicalPlace; message: string }>(
    "/admin/entities/places/merge",
    { keepId, mergeId },
  );
}

export async function bulkMergePlaces(
  keepId: string,
  mergeIds: string[],
): Promise<{ place: CanonicalPlace; message: string }> {
  return apiPost<{ place: CanonicalPlace; message: string }>(
    "/admin/entities/places/bulk-merge",
    { keepId, mergeIds },
  );
}

export async function getPlaceMergeDetails(placeId: string): Promise<PlaceMergeDetails> {
  return apiGet<PlaceMergeDetails>(`/admin/entities/places/${placeId}/merge-details`);
}
