import type { PublicLetter } from "../types/Letter";

type LinkedPersonSource = NonNullable<PublicLetter["linkedPersons"]>[number];
type LinkedPlaceSource = NonNullable<PublicLetter["linkedPlaces"]>[number];
type DiscoveryLetter = Pick<PublicLetter, "linkedPersons" | "linkedPlaces">;

export interface PublicLinkedPerson {
  personId: string;
  canonicalName: string;
  roles: string[];
}

export interface PublicLinkedPlace {
  placeId: string;
  canonicalName: string;
  roles: string[];
}

function mergeRoles(existing: string[], incomingRole?: string): string[] {
  if (!incomingRole || existing.includes(incomingRole)) return existing;
  return [...existing, incomingRole];
}

function dedupeLinkedPersons(linkedPersons: LinkedPersonSource[] | undefined): PublicLinkedPerson[] {
  if (!linkedPersons || linkedPersons.length === 0) return [];
  const map = new Map<string, PublicLinkedPerson>();

  for (const person of linkedPersons) {
    const existing = map.get(person.personId);
    if (!existing) {
      map.set(person.personId, {
        personId: person.personId,
        canonicalName: person.canonicalName,
        roles: person.role ? [person.role] : [],
      });
      continue;
    }

    existing.roles = mergeRoles(existing.roles, person.role);
  }

  return Array.from(map.values()).sort((a, b) =>
    a.canonicalName.localeCompare(b.canonicalName),
  );
}

function dedupeLinkedPlaces(linkedPlaces: LinkedPlaceSource[] | undefined): PublicLinkedPlace[] {
  if (!linkedPlaces || linkedPlaces.length === 0) return [];
  const map = new Map<string, PublicLinkedPlace>();

  for (const place of linkedPlaces) {
    const existing = map.get(place.placeId);
    if (!existing) {
      map.set(place.placeId, {
        placeId: place.placeId,
        canonicalName: place.canonicalName,
        roles: place.role ? [place.role] : [],
      });
      continue;
    }

    existing.roles = mergeRoles(existing.roles, place.role);
  }

  return Array.from(map.values()).sort((a, b) =>
    a.canonicalName.localeCompare(b.canonicalName),
  );
}

export function buildLetterDiscoveryLinks(letter: DiscoveryLetter): {
  persons: PublicLinkedPerson[];
  places: PublicLinkedPlace[];
} {
  return {
    persons: dedupeLinkedPersons(letter.linkedPersons),
    places: dedupeLinkedPlaces(letter.linkedPlaces),
  };
}
