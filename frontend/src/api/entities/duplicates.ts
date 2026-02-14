import { apiGet } from "../client";
import type { DuplicateSuggestion } from "./types";

export async function getDuplicateSuggestions(
  entityType: "person" | "place",
  limit: number = 20,
): Promise<{ suggestions: DuplicateSuggestion[] }> {
  return apiGet<{ suggestions: DuplicateSuggestion[] }>(
    "/admin/entities/suggestions",
    { entityType, limit },
  );
}
