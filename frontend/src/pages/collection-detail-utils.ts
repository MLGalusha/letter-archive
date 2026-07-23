import type { CollectionProfileCorrespondent, KeyPerson } from "../api/collections";
import type { LetterImageType, PublicLetter } from "../types/Letter";
import { getMediaLabel, getPrimaryMediaType } from "../utils/letterPreview";

/** Fields shared by public projections and full admin letters in collection UI. */
type CollectionLetter = Pick<
  PublicLetter,
  | "id"
  | "images"
  | "metadata"
  | "transcriptStatus"
  | "metadataContentStatus"
  | "photoDescription"
>;

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

export interface CollectionStats {
  dateSpan: { start: string; end: string; label: string } | null;
  formatBreakdown: string;
}

function parseDateRaw(raw: string | undefined | null): Date | null {
  if (!raw || raw.length < 8) return null;
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 8);
  if (digits.length < 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6)) - 1;
  const day = Number(digits.slice(6, 8));
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return new Date(year, month, day);
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural || singular + "s"}`;
}

const FORMAT_LABELS: Record<LetterImageType, [string, string]> = {
  letter: ["letter", "letters"],
  photo: ["photo", "photos"],
  telegram: ["telegram", "telegrams"],
  cover: ["cover", "covers"],
  card: ["card", "cards"],
  ephemera: ["ephemeron", "ephemera"],
  article: ["article", "articles"],
  diary: ["diary entry", "diary entries"],
  voice: ["voice recording", "voice recordings"],
};

const FORMAT_DISPLAY_ORDER: LetterImageType[] = [
  "letter", "telegram", "cover", "card", "ephemera", "article", "diary", "voice", "photo",
];

export function computeCollectionStats(letters: CollectionLetter[]): CollectionStats {
  const dated = letters
    .map((l) => ({ letter: l, date: parseDateRaw(l.metadata.dateRaw) }))
    .filter((entry): entry is { letter: CollectionLetter; date: Date } => entry.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  // Date span
  let dateSpan: CollectionStats["dateSpan"] = null;
  if (dated.length >= 2) {
    const start = dated[0].date;
    const end = dated[dated.length - 1].date;
    dateSpan = {
      start: formatDateShort(start),
      end: formatDateShort(end),
      label: `${formatDateShort(start)} \u2014 ${formatDateShort(end)}`,
    };
  } else if (dated.length === 1) {
    const d = formatDateShort(dated[0].date);
    dateSpan = { start: d, end: d, label: d };
  }

  // Format breakdown
  const formatCounts = new Map<LetterImageType, number>();
  for (const letter of letters) {
    const presentTypes = new Set<LetterImageType>();

    for (const image of letter.images) {
      presentTypes.add(image.type);
    }

    if (presentTypes.size === 0) {
      presentTypes.add(getPrimaryMediaType(letter));
    }

    for (const mediaType of presentTypes) {
      formatCounts.set(mediaType, (formatCounts.get(mediaType) || 0) + 1);
    }
  }
  const formatParts = FORMAT_DISPLAY_ORDER
    .filter((type) => formatCounts.has(type))
    .map((type) => {
      const count = formatCounts.get(type)!;
      const [singular, plural] = FORMAT_LABELS[type];
      return pluralize(count, singular, plural);
    });
  const formatBreakdown = formatParts.join(" \u00B7 ") || `${letters.length} items`;

  return { dateSpan, formatBreakdown };
}

/* ------------------------------------------------------------------ */
/*  Letter Highlights                                                  */
/* ------------------------------------------------------------------ */

export interface LetterHighlight {
  letter: CollectionLetter;
  label: string;
}

/**
 * Quality tier for a letter (lower = better):
 *   1 = Fully verified (transcript AND metadata VERIFIED)
 *   2 = Half verified (transcript OR metadata VERIFIED)
 *   3 = Has metadata  (metadata is AI_DRAFT or EDITED)
 *   4 = Any
 */
function qualityTier(letter: CollectionLetter): number {
  const tv = letter.transcriptStatus === "VERIFIED";
  const mv = letter.metadataContentStatus === "VERIFIED";
  if (tv && mv) return 1;
  if (tv || mv) return 2;
  if (letter.metadataContentStatus === "AI_DRAFT" || letter.metadataContentStatus === "EDITED") return 3;
  return 4;
}

/**
 * Pick the best highlight letter using priority tiers:
 *   1. If admin pinned a start-here letter, use that
 *   2. Otherwise, pick the best letter by verification quality
 *      (fully verified > half verified > has metadata > any),
 *      preferring letters with images, random within the top tier
 */
export function pickLetterHighlights(
  letters: CollectionLetter[],
  startHereLetterId?: string | null,
): LetterHighlight[] {
  if (letters.length === 0) return [];

  const highlights: LetterHighlight[] = [];
  const used = new Set<string>();

  const add = (letter: CollectionLetter, label: string) => {
    if (used.has(letter.id)) return;
    used.add(letter.id);
    highlights.push({ letter, label });
  };

  // 1. Pinned / start-here (admin override)
  if (startHereLetterId) {
    const pinned = letters.find((l) => l.id === startHereLetterId);
    if (pinned) add(pinned, "Pinned");
  }

  // 2. Auto-select best letter by quality tier
  if (highlights.length === 0) {
    const candidates = letters.filter((l) => !used.has(l.id));
    if (candidates.length > 0) {
      const bestTier = Math.min(...candidates.map(qualityTier));
      const tierPool = candidates.filter((l) => qualityTier(l) === bestTier);
      // Prefer letters with images
      const withImages = tierPool.filter((l) => l.images.length > 0 && l.images[0].imageUrl);
      const pool = withImages.length > 0 ? withImages : tierPool;
      // Random from pool
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick) add(pick, "Featured");
    }
  }

  return highlights;
}

/* ------------------------------------------------------------------ */
/*  Extra Content Gallery                                              */
/* ------------------------------------------------------------------ */

export interface GalleryItem {
  letterId: string;
  imageId: string;
  imageUrl: string;
  mediaType: LetterImageType;
  mediaLabel: string;
  sender: string | null;
  recipient: string | null;
  date: string | null;
  dateRaw: string | null;
  hook: string;
}

/**
 * Build a gallery of all extra content images across the collection.
 * Photos first, then covers, cards, ephemera, articles, diary.
 * Excludes letter pages, telegrams, and voice (audio not yet supported).
 *
 * Hook logic: if the letter's primary type IS the extra content type
 * (i.e. the letter is purely that extra content), show the hook.
 * If the letter is primarily a "letter" with extra content attached,
 * omit the hook since it describes the letter, not the extra content.
 */
export function buildExtraContentGallery(letters: CollectionLetter[]): GalleryItem[] {
  const GALLERY_TYPES: LetterImageType[] = [
    "photo", "cover", "card", "telegram", "ephemera", "article", "diary",
  ];
  const galleryTypeSet = new Set<LetterImageType>(GALLERY_TYPES);

  // Collect items grouped by type for ordering (photos first, etc.)
  const buckets = new Map<LetterImageType, GalleryItem[]>();
  for (const type of GALLERY_TYPES) buckets.set(type, []);

  for (const letter of letters) {
    const primaryType = getPrimaryMediaType(letter);

    for (const image of letter.images) {
      if (!image.imageUrl) continue;
      if (!galleryTypeSet.has(image.type)) continue;

      // Only show hook when the letter IS purely this extra content
      const isStandalone = primaryType === image.type;
      let hook = "";
      if (isStandalone) {
        hook = image.type === "photo"
          ? (letter.photoDescription || letter.metadata.hook || "")
          : (letter.metadata.hook || "");
      }

      buckets.get(image.type)!.push({
        letterId: letter.id,
        imageId: image.id,
        imageUrl: image.imageUrl,
        mediaType: image.type,
        mediaLabel: getMediaLabel(image.type),
        sender: letter.metadata.sender?.trim() || null,
        recipient: letter.metadata.recipient?.trim() || null,
        date: letter.metadata.date || letter.metadata.dateRaw || null,
        dateRaw: letter.metadata.dateRaw || null,
        hook,
      });
    }
  }

  // Sort by dateRaw (YYYYMMDD) — simple string compare works
  const sortByDate = (a: GalleryItem, b: GalleryItem) =>
    (a.dateRaw || "").localeCompare(b.dateRaw || "");

  // Photos first (sorted by date), then everything else merged and sorted by date
  const photos = buckets.get("photo")!.sort(sortByDate);
  const rest: GalleryItem[] = [];
  for (const type of GALLERY_TYPES) {
    if (type === "photo") continue;
    rest.push(...buckets.get(type)!);
  }
  rest.sort(sortByDate);

  return [...photos, ...rest];
}

/* ------------------------------------------------------------------ */
/*  Correspondents                                                     */
/* ------------------------------------------------------------------ */

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

export interface Correspondent {
  name: string;
  sentCount: number;
  receivedCount: number;
  totalLetters: number;
  biography: string | null;
  hook: string | null;
}

export function buildCorrespondents(
  letters: CollectionLetter[],
  keyPeople?: KeyPerson[] | null,
  profileCorrespondents?: CollectionProfileCorrespondent[] | null,
): Correspondent[] {
  const map = new Map<string, { name: string; sent: number; received: number }>();

  for (const letter of letters) {
    const sender = letter.metadata.sender?.trim();
    const recipient = letter.metadata.recipient?.trim();

    if (sender) {
      const key = normalizeValue(sender);
      const existing = map.get(key);
      if (existing) {
        existing.sent += 1;
      } else {
        map.set(key, { name: sender, sent: 1, received: 0 });
      }
    }

    if (recipient) {
      const key = normalizeValue(recipient);
      const existing = map.get(key);
      if (existing) {
        existing.received += 1;
      } else {
        map.set(key, { name: recipient, sent: 0, received: 1 });
      }
    }
  }

  // Build bio/hook lookup from keyPeople (normalized name → data)
  const bioLookup = new Map<string, { biography: string | null; hook: string | null }>();
  if (keyPeople) {
    for (const person of keyPeople) {
      bioLookup.set(normalizeValue(person.name), {
        biography: person.biography || null,
        hook: person.hook || null,
      });
    }
  }

  if (profileCorrespondents) {
    for (const person of profileCorrespondents) {
      bioLookup.set(normalizeValue(person.name), {
        biography: person.biography || null,
        hook: person.hook || null,
      });
    }
  }

  return Array.from(map.values())
    .map((entry) => {
      const lookup = bioLookup.get(normalizeValue(entry.name));
      return {
        name: entry.name,
        sentCount: entry.sent,
        receivedCount: entry.received,
        totalLetters: entry.sent + entry.received,
        biography: lookup?.biography || null,
        hook: lookup?.hook || null,
      };
    })
    .sort((a, b) => b.totalLetters - a.totalLetters)
    .slice(0, 6);
}
