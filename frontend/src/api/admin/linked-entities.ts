import { apiDelete, apiPost, apiPut } from "../client";
import type { Letter, PersonRole, PlaceRole } from "../../types/Letter";

export async function updateLinkedPerson(
  letterId: string,
  linkId: string,
  canonicalName: string,
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/linked-persons/${linkId}`, { canonicalName });
}

export async function updateLinkedPlace(
  letterId: string,
  linkId: string,
  canonicalName: string,
): Promise<Letter> {
  return apiPut<Letter>(`/admin/letters/${letterId}/linked-places/${linkId}`, { canonicalName });
}

export async function addLinkedPerson(
  letterId: string,
  name: string,
  role: PersonRole,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/linked-persons`, { name, role });
}

export async function addLinkedPlace(
  letterId: string,
  name: string,
  role: PlaceRole,
): Promise<Letter> {
  return apiPost<Letter>(`/admin/letters/${letterId}/linked-places`, { name, role });
}

export async function removeLinkedPerson(letterId: string, linkId: string): Promise<Letter> {
  return apiDelete<Letter>(`/admin/letters/${letterId}/linked-persons/${linkId}`);
}

export async function removeLinkedPlace(letterId: string, linkId: string): Promise<Letter> {
  return apiDelete<Letter>(`/admin/letters/${letterId}/linked-places/${linkId}`);
}
