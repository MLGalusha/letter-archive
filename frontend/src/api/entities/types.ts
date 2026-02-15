import type {
  ContentStatus,
  PersonRelationshipType,
  PersonRole,
  PlaceRole,
  PlaceType,
} from "../../types/Letter";
export type { PersonRelationshipType } from "../../types/Letter";

export interface CanonicalPerson {
  id: string;
  canonicalName: string;
  aliases: string[];
  notes?: string;
  biography?: string;
  biographyStatus?: ContentStatus;
  biographyVerifiedAt?: string;
  biographyVerifiedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanonicalPlace {
  id: string;
  canonicalName: string;
  aliases: string[];
  placeType?: PlaceType;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonWithCount extends CanonicalPerson {
  letterCount: number;
}

export interface PlaceWithCount extends CanonicalPlace {
  letterCount: number;
}

export interface EntityMatch {
  entityId: string;
  canonicalName: string;
  matchedOn: "canonical_name" | "alias";
  similarity: number;
}

export interface EntityReviewItem {
  id: string;
  entityType: "person" | "place";
  extractedText: string;
  letterId: string;
  suggestedEntityId?: string;
  suggestedEntityName?: string;
  context?: string;
  confidence: number;
  status: "pending" | "confirmed" | "rejected" | "new_entity";
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface ReviewQueueStats {
  pending: { persons: number; places: number };
  resolved: { confirmed: number; rejected: number; newEntity: number };
}

export interface LetterForEntity {
  letterId: string;
  dateRaw: string;
  letterDate?: string | null;
  role: PersonRole | PlaceRole;
  context?: string | null;
  sender?: string | null;
  recipient?: string | null;
  hook?: string | null;
  summary?: string | null;
  visibility?: "PUBLISHED" | "HIDDEN";
}

export interface PersonRelationship {
  id: string;
  personAId: string;
  personBId: string;
  personAName: string;
  personBName: string;
  relationshipType: PersonRelationshipType;
  notes?: string;
  discoveredInLetterId?: string;
  confidence: number;
  confirmedBy?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicLetterForEntity {
  id: string;
  dateRaw: string;
  letterDate?: string;
  role: PersonRole | PlaceRole;
  sender?: string;
  recipient?: string;
  hook?: string;
  summary?: string;
}

export interface PublicPersonDetail {
  person: {
    id: string;
    canonicalName: string;
    aliases: string[];
    biography?: string;
    biographyStatus?: ContentStatus;
  };
  relationships: Array<{
    id: string;
    relatedPersonId: string;
    relatedPersonName: string;
    relationshipType: PersonRelationshipType;
  }>;
  stats: {
    asSender: number;
    asRecipient: number;
    asMentioned: number;
    total: number;
  };
  letters: PublicLetterForEntity[];
}

export interface PublicPlaceDetail {
  place: {
    id: string;
    canonicalName: string;
    aliases: string[];
    placeType?: PlaceType;
    notes?: string;
    themes?: string[];
  };
  stats: {
    writtenFrom: number;
    mentioned: number;
    destination: number;
    total: number;
  };
  letters: PublicLetterForEntity[];
}

export interface GraphNode {
  id: string;
  name: string;
  letterCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: PersonRelationshipType;
  confidence: number;
}

export interface RelationshipGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathNode {
  id: string;
  name: string;
}

export interface PathEdge {
  id: string;
  type: string;
}

export interface ConnectionPath {
  path: PathNode[];
  edges: PathEdge[];
  message?: string;
}

export interface DuplicateSuggestion {
  entityAId: string;
  entityAName: string;
  entityALetterCount: number;
  entityAAliases: string[];
  entityBId: string;
  entityBName: string;
  entityBLetterCount: number;
  entityBAliases: string[];
  similarity: number;
}

export interface PersonMergeDetails {
  id: string;
  canonicalName: string;
  aliases: string[];
  letterCount: number;
  asSender: number;
  asRecipient: number;
  asMentioned: number;
  relationshipCount: number;
  relationships: Array<{
    personId: string;
    personName: string;
    relationshipType: string;
  }>;
  biography?: string;
  biographyStatus?: ContentStatus;
}

export interface SameNamePersonCandidate {
  id: string;
  canonicalName: string;
  aliases: string[];
  letterCount: number;
}

export interface PlaceMergeDetails {
  id: string;
  canonicalName: string;
  aliases: string[];
  placeType?: PlaceType;
  letterCount: number;
  writtenFrom: number;
  destination: number;
  mentioned: number;
}

export interface SameNamePlaceCandidate {
  id: string;
  canonicalName: string;
  aliases: string[];
  placeType?: PlaceType | null;
  letterCount: number;
}
