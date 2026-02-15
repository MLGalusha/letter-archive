import { apiGet, apiPost, apiPut } from "../client";
import type {
  CanonicalPerson,
  EntityMatch,
  LetterForEntity,
  PersonMergeDetails,
  PersonWithCount,
} from "./types";

export async function getAllPersons(): Promise<{ persons: PersonWithCount[] }> {
  return apiGet<{ persons: PersonWithCount[] }>("/admin/entities/persons");
}

export async function searchPersons(query: string): Promise<{ matches: EntityMatch[] }> {
  return apiGet<{ matches: EntityMatch[] }>("/admin/entities/persons/search", { q: query });
}

export async function getPersonById(personId: string): Promise<{
  person: CanonicalPerson;
  letters: LetterForEntity[];
}> {
  return apiGet<{ person: CanonicalPerson; letters: LetterForEntity[] }>(
    `/admin/entities/persons/${personId}`,
  );
}

export async function createPerson(data: {
  canonicalName: string;
  aliases?: string[];
  notes?: string;
}): Promise<{ person: CanonicalPerson }> {
  return apiPost<{ person: CanonicalPerson }>("/admin/entities/persons", data);
}

export async function updatePerson(
  personId: string,
  data: {
    canonicalName?: string;
    aliases?: string[];
    notes?: string | null;
  },
): Promise<{ person: CanonicalPerson; undoActionId?: string | null }> {
  return apiPut<{ person: CanonicalPerson; undoActionId?: string | null }>(
    `/admin/entities/persons/${personId}`,
    data,
  );
}

export async function mergePersons(
  keepId: string,
  mergeId: string,
): Promise<{ person: CanonicalPerson; message: string; undoActionId?: string | null }> {
  return apiPost<{ person: CanonicalPerson; message: string; undoActionId?: string | null }>(
    "/admin/entities/persons/merge",
    { keepId, mergeId },
  );
}

export async function bulkMergePersons(
  keepId: string,
  mergeIds: string[],
): Promise<{ person: CanonicalPerson; message: string }> {
  return apiPost<{ person: CanonicalPerson; message: string }>(
    "/admin/entities/persons/bulk-merge",
    { keepId, mergeIds },
  );
}

export async function getPersonMergeDetails(personId: string): Promise<PersonMergeDetails> {
  return apiGet<PersonMergeDetails>(`/admin/entities/persons/${personId}/merge-details`);
}

export async function generateBiography(personId: string): Promise<{ person: CanonicalPerson }> {
  return apiPost<{ person: CanonicalPerson }>(`/admin/entities/persons/${personId}/biography/generate`);
}

export async function saveBiography(
  personId: string,
  data: { biography: string; verify?: boolean },
): Promise<{ person: CanonicalPerson }> {
  return apiPut<{ person: CanonicalPerson }>(`/admin/entities/persons/${personId}/biography`, data);
}

export async function unverifyBiography(personId: string): Promise<{ person: CanonicalPerson }> {
  return apiPost<{ person: CanonicalPerson }>(`/admin/entities/persons/${personId}/biography/unverify`);
}

export async function undoPersonAction(
  actionId: string,
  actionType: "rename" | "merge",
): Promise<{ message: string }> {
  return apiPost<{ message: string }>(`/admin/entities/persons/actions/${actionId}/undo`, {
    actionType,
  });
}
