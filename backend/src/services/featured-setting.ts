import { and, eq } from 'drizzle-orm';
import { db, siteSettings } from '../db/index.js';
import { resolveRepresentativeLetterId } from './letters.js';

export type FeaturedSettingKey = 'featured_letter_id' | 'auto_featured_letter_id';

export interface ResolvedFeaturedSetting<T> {
  letterId: string;
  letter: T;
}

type FetchLetter<T> = (letterId: string) => Promise<T | null>;
type IsUsableLetter<T> = (letter: T) => boolean;

const MAX_REPAIR_ATTEMPTS = 3;

async function readSetting(key: FeaturedSettingKey): Promise<string | null> {
  const [setting] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, key))
    .limit(1);

  return setting?.value ?? null;
}

async function loadCandidate<T>(
  observedId: string,
  fetchLetter: FetchLetter<T>,
  isUsable: IsUsableLetter<T>,
): Promise<ResolvedFeaturedSetting<T> | null> {
  const letterId = await resolveRepresentativeLetterId(observedId, { publishedOnly: true });
  if (!letterId) return null;

  const letter = await fetchLetter(letterId);
  if (!letter || !isUsable(letter)) return null;

  return { letterId, letter };
}

async function replaceIfUnchanged(
  key: FeaturedSettingKey,
  observedId: string,
  replacementId: string,
): Promise<boolean> {
  const updated = await db
    .update(siteSettings)
    .set({ value: replacementId, updatedAt: new Date() })
    .where(and(
      eq(siteSettings.key, key),
      eq(siteSettings.value, observedId),
    ))
    .returning({ value: siteSettings.value });

  return updated.length > 0;
}

async function deleteIfUnchanged(
  key: FeaturedSettingKey,
  observedId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(siteSettings)
    .where(and(
      eq(siteSettings.key, key),
      eq(siteSettings.value, observedId),
    ))
    .returning({ value: siteSettings.value });

  return deleted.length > 0;
}

/**
 * Resolves a stored featured-letter setting without allowing a background
 * normalization or stale-value cleanup to overwrite a newer curator choice.
 * When a compare-and-swap loses, the current winner is read and resolved.
 */
export async function resolveFeaturedSetting<T>(
  key: FeaturedSettingKey,
  fetchLetter: FetchLetter<T>,
  isUsable: IsUsableLetter<T> = () => true,
): Promise<ResolvedFeaturedSetting<T> | null> {
  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const observedId = await readSetting(key);
    if (!observedId) return null;

    const candidate = await loadCandidate(observedId, fetchLetter, isUsable);
    if (candidate) {
      if (candidate.letterId === observedId) return candidate;

      if (await replaceIfUnchanged(key, observedId, candidate.letterId)) {
        return candidate;
      }
      continue;
    }

    if (await deleteIfUnchanged(key, observedId)) return null;
  }

  // Under sustained contention, return the latest readable winner without
  // making another repair attempt.
  const winnerId = await readSetting(key);
  return winnerId ? loadCandidate(winnerId, fetchLetter, isUsable) : null;
}
