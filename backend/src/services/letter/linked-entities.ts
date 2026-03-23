import { and, eq } from 'drizzle-orm';
import {
  canonicalPersons,
  canonicalPlaces,
  db,
  letterPersons,
  letterPlaces,
  letters,
} from '../../db/index.js';
import { log } from './shared.js';

export async function updateLinkedPerson(
  letterId: string,
  linkId: string,
  canonicalName: string,
): Promise<true | null> {
  const link = await db.query.letterPersons.findFirst({
    where: and(
      eq(letterPersons.id, linkId),
      eq(letterPersons.letterId, letterId),
    ),
    with: { person: true },
  });

  if (!link) return null;

  await db.update(canonicalPersons).set({
    canonicalName,
    updatedAt: new Date(),
  }).where(eq(canonicalPersons.id, link.personId));

  log.info({ letterId, linkId, personId: link.personId, newName: canonicalName }, 'Linked person name updated');
  return true;
}

export async function updateLinkedPlace(
  letterId: string,
  linkId: string,
  canonicalName: string,
): Promise<true | null> {
  const link = await db.query.letterPlaces.findFirst({
    where: and(
      eq(letterPlaces.id, linkId),
      eq(letterPlaces.letterId, letterId),
    ),
    with: { place: true },
  });

  if (!link) return null;

  await db.update(canonicalPlaces).set({
    canonicalName,
    updatedAt: new Date(),
  }).where(eq(canonicalPlaces.id, link.placeId));

  log.info({ letterId, linkId, placeId: link.placeId, newName: canonicalName }, 'Linked place name updated');
  return true;
}

export async function addLinkedPerson(
  letterId: string,
  name: string,
  role: 'sender' | 'recipient' | 'mentioned',
): Promise<true | null> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) return null;

  let person = await db.query.canonicalPersons.findFirst({
    where: eq(canonicalPersons.canonicalName, name),
  });

  if (!person) {
    const [newPerson] = await db.insert(canonicalPersons).values({
      canonicalName: name,
    }).returning();
    if (!newPerson) {
      throw new Error('Failed to create canonical person');
    }
    person = newPerson;
    log.info({ letterId, personId: person.id, name }, 'Created new canonical person');
  }

  const existingLink = await db.query.letterPersons.findFirst({
    where: and(
      eq(letterPersons.letterId, letterId),
      eq(letterPersons.personId, person.id),
      eq(letterPersons.role, role),
    ),
  });

  if (existingLink) {
    const err = new Error('Person already linked with this role') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  await db.insert(letterPersons).values({
    letterId,
    personId: person.id,
    role,
    nameAsWritten: name,
    confidence: 100,
  });

  log.info({ letterId, personId: person.id, name, role }, 'Linked person to letter');
  return true;
}

export async function addLinkedPlace(
  letterId: string,
  name: string,
  role: 'written_from' | 'mentioned' | 'destination',
): Promise<true | null> {
  const letter = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });

  if (!letter) return null;

  let place = await db.query.canonicalPlaces.findFirst({
    where: eq(canonicalPlaces.canonicalName, name),
  });

  if (!place) {
    const [newPlace] = await db.insert(canonicalPlaces).values({
      canonicalName: name,
      placeType: 'other',
    }).returning();
    if (!newPlace) {
      throw new Error('Failed to create canonical place');
    }
    place = newPlace;
    log.info({ letterId, placeId: place.id, name }, 'Created new canonical place');
  }

  const existingLink = await db.query.letterPlaces.findFirst({
    where: and(
      eq(letterPlaces.letterId, letterId),
      eq(letterPlaces.placeId, place.id),
      eq(letterPlaces.role, role),
    ),
  });

  if (existingLink) {
    const err = new Error('Place already linked with this role') as Error & { status: number };
    err.status = 400;
    throw err;
  }

  await db.insert(letterPlaces).values({
    letterId,
    placeId: place.id,
    role,
    nameAsWritten: name,
    confidence: 100,
  });

  log.info({ letterId, placeId: place.id, name, role }, 'Linked place to letter');
  return true;
}

export async function removeLinkedPerson(letterId: string, linkId: string): Promise<true | null> {
  const link = await db.query.letterPersons.findFirst({
    where: and(
      eq(letterPersons.id, linkId),
      eq(letterPersons.letterId, letterId),
    ),
  });

  if (!link) return null;

  await db.delete(letterPersons).where(eq(letterPersons.id, linkId));

  log.info({ letterId, linkId }, 'Removed linked person from letter');
  return true;
}

export async function removeLinkedPlace(letterId: string, linkId: string): Promise<true | null> {
  const link = await db.query.letterPlaces.findFirst({
    where: and(
      eq(letterPlaces.id, linkId),
      eq(letterPlaces.letterId, letterId),
    ),
  });

  if (!link) return null;

  await db.delete(letterPlaces).where(eq(letterPlaces.id, linkId));

  log.info({ letterId, linkId }, 'Removed linked place from letter');
  return true;
}
