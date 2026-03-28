import { eq } from 'drizzle-orm';
import { db, canonicalPersons, type ContentStatus } from '../db/index.js';

export interface BiographyUpdateData {
  biography?: string;
  hook?: string;
  biographyStatus?: ContentStatus;
  biographyVerifiedAt?: Date | null;
  biographyVerifiedBy?: string | null;
}

/**
 * Update a person's biography and status fields.
 */
export async function updatePersonBiography(
  personId: string,
  data: BiographyUpdateData
): Promise<void> {
  const updateFields: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.biography !== undefined) {
    updateFields.biography = data.biography;
  }
  if (data.hook !== undefined) {
    updateFields.hook = data.hook;
  }
  if (data.biographyStatus !== undefined) {
    updateFields.biographyStatus = data.biographyStatus;
  }
  if (data.biographyVerifiedAt !== undefined) {
    updateFields.biographyVerifiedAt = data.biographyVerifiedAt;
  }
  if (data.biographyVerifiedBy !== undefined) {
    updateFields.biographyVerifiedBy = data.biographyVerifiedBy;
  }

  await db
    .update(canonicalPersons)
    .set(updateFields)
    .where(eq(canonicalPersons.id, personId));
}
