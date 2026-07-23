import { eq, asc } from 'drizzle-orm';
import {
  db,
  letterPersons,
  letterPlaces,
  letters,
  type NewLetterPerson,
  type NewLetterPlace,
  type LetterPerson,
  type LetterPlace,
  type CanonicalPerson,
  type CanonicalPlace,
  type PersonRole,
  type PlaceRole,
  type LetterType,
  type VisibilityState,
} from '../../db/index.js';
import { publicEntityProjectionSql } from './public-projection.js';

export async function createLetterPerson(
  data: Omit<NewLetterPerson, 'id' | 'createdAt'>,
): Promise<string | undefined> {
  const [lp] = await db
    .insert(letterPersons)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: letterPersons.id });
  return lp?.id;
}

export async function createLetterPlace(
  data: Omit<NewLetterPlace, 'id' | 'createdAt'>,
): Promise<string | undefined> {
  const [lp] = await db
    .insert(letterPlaces)
    .values(data)
    .onConflictDoNothing()
    .returning({ id: letterPlaces.id });
  return lp?.id;
}

export async function getPersonsForLetter(
  letterId: string,
): Promise<(LetterPerson & { person: CanonicalPerson })[]> {
  return db.query.letterPersons.findMany({
    where: eq(letterPersons.letterId, letterId),
    with: { person: true },
  });
}

export async function getPlacesForLetter(
  letterId: string,
): Promise<(LetterPlace & { place: CanonicalPlace })[]> {
  return db.query.letterPlaces.findMany({
    where: eq(letterPlaces.letterId, letterId),
    with: { place: true },
  });
}

export async function getLettersForPerson(
  personId: string,
): Promise<{ letterId: string; role: PersonRole; context: string | null }[]> {
  const results = await db.query.letterPersons.findMany({
    where: eq(letterPersons.personId, personId),
  });
  return results.map((r) => ({
    letterId: r.letterId,
    role: r.role,
    context: r.context,
  }));
}

export async function getLettersForPlace(
  placeId: string,
): Promise<{ letterId: string; role: PlaceRole; context: string | null }[]> {
  const results = await db.query.letterPlaces.findMany({
    where: eq(letterPlaces.placeId, placeId),
  });
  return results.map((r) => ({
    letterId: r.letterId,
    role: r.role,
    context: r.context,
  }));
}

export interface EnrichedLetterForPerson {
  letterId: string;
  collectionId: string;
  typeSequence: number;
  type: LetterType;
  role: PersonRole;
  context: string | null;
  dateRaw: string;
  letterDate: string | null;
  sender: string | null;
  recipient: string | null;
  hook: string | null;
  summary: string | null;
  visibility: VisibilityState;
  metadataPublished: boolean;
  entityProjectionTrusted: boolean;
}

export async function getLettersForPersonEnriched(
  personId: string,
): Promise<EnrichedLetterForPerson[]> {
  return db
    .select({
      letterId: letterPersons.letterId,
      collectionId: letters.collectionId,
      typeSequence: letters.typeSequence,
      type: letters.type,
      role: letterPersons.role,
      context: letterPersons.context,
      dateRaw: letters.dateRaw,
      letterDate: letters.letterDate,
      sender: letters.sender,
      recipient: letters.recipient,
      hook: letters.hook,
      summary: letters.summary,
      visibility: letters.visibility,
      metadataPublished: letters.metadataPublished,
      entityProjectionTrusted: publicEntityProjectionSql(
        letterPersons.confirmedAt,
        letterPersons.entityExtractionRevision,
        letters.entityExtractionRevision,
        letters.entityExtractionJson,
      ),
    })
    .from(letterPersons)
    .innerJoin(letters, eq(letterPersons.letterId, letters.id))
    .where(eq(letterPersons.personId, personId))
    .orderBy(asc(letters.letterDate), asc(letters.dateRaw));
}

export interface EnrichedLetterForPlace {
  letterId: string;
  collectionId: string;
  typeSequence: number;
  type: LetterType;
  role: PlaceRole;
  context: string | null;
  dateRaw: string;
  letterDate: string | null;
  sender: string | null;
  recipient: string | null;
  hook: string | null;
  summary: string | null;
  visibility: VisibilityState;
  metadataPublished: boolean;
  entityProjectionTrusted: boolean;
}

export async function getLettersForPlaceEnriched(
  placeId: string,
): Promise<EnrichedLetterForPlace[]> {
  return db
    .select({
      letterId: letterPlaces.letterId,
      collectionId: letters.collectionId,
      typeSequence: letters.typeSequence,
      type: letters.type,
      role: letterPlaces.role,
      context: letterPlaces.context,
      dateRaw: letters.dateRaw,
      letterDate: letters.letterDate,
      sender: letters.sender,
      recipient: letters.recipient,
      hook: letters.hook,
      summary: letters.summary,
      visibility: letters.visibility,
      metadataPublished: letters.metadataPublished,
      entityProjectionTrusted: publicEntityProjectionSql(
        letterPlaces.confirmedAt,
        letterPlaces.entityExtractionRevision,
        letters.entityExtractionRevision,
        letters.entityExtractionJson,
      ),
    })
    .from(letterPlaces)
    .innerJoin(letters, eq(letterPlaces.letterId, letters.id))
    .where(eq(letterPlaces.placeId, placeId))
    .orderBy(asc(letters.letterDate), asc(letters.dateRaw));
}
