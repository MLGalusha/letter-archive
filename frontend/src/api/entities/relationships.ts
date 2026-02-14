import { apiDelete, apiGet, apiPost, apiPut } from "../client";
import type { PersonRelationshipType } from "../../types/Letter";
import type {
  ConnectionPath,
  PersonRelationship,
  RelationshipGraphData,
} from "./types";

export async function getAllRelationships(): Promise<{ relationships: PersonRelationship[] }> {
  return apiGet<{ relationships: PersonRelationship[] }>("/admin/entities/relationships");
}

export async function getRelationshipsForPerson(
  personId: string,
): Promise<{ relationships: PersonRelationship[] }> {
  return apiGet<{ relationships: PersonRelationship[] }>(`/admin/entities/relationships/person/${personId}`);
}

export async function createRelationship(data: {
  personAId: string;
  personBId: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence?: number;
}): Promise<{ relationship: PersonRelationship }> {
  return apiPost<{ relationship: PersonRelationship }>("/admin/entities/relationships", data);
}

export async function updateRelationship(
  relationshipId: string,
  data: {
    relationshipType?: PersonRelationshipType;
    notes?: string | null;
    confidence?: number;
  },
): Promise<{ relationship: PersonRelationship }> {
  return apiPut<{ relationship: PersonRelationship }>(`/admin/entities/relationships/${relationshipId}`, data);
}

export async function deleteRelationship(relationshipId: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/admin/entities/relationships/${relationshipId}`);
}

export async function getRelationshipGraph(): Promise<RelationshipGraphData> {
  return apiGet<RelationshipGraphData>("/relationships");
}

export async function getRelationshipGraphByCollection(
  collectionId: string,
): Promise<RelationshipGraphData> {
  return apiGet<RelationshipGraphData>(`/relationships/collection/${collectionId}`);
}

export async function findConnectionPath(
  personAId: string,
  personBId: string,
): Promise<ConnectionPath> {
  return apiGet<ConnectionPath>(`/relationships/path/${personAId}/${personBId}`);
}

export async function getAdminRelationships(): Promise<PersonRelationship[]> {
  return apiGet<PersonRelationship[]>("/admin/relationships");
}

export async function createAdminRelationship(data: {
  personAId: string;
  personBId: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence?: number;
}): Promise<PersonRelationship> {
  return apiPost<PersonRelationship>("/admin/relationships", data);
}

export async function updateAdminRelationship(
  relationshipId: string,
  data: {
    relationshipType?: PersonRelationshipType;
    notes?: string | null;
    confidence?: number;
  },
): Promise<PersonRelationship> {
  return apiPut<PersonRelationship>(`/admin/relationships/${relationshipId}`, data);
}

export async function deleteAdminRelationship(relationshipId: string): Promise<void> {
  return apiDelete<void>(`/admin/relationships/${relationshipId}`);
}
