import { sql, type SQLWrapper } from 'drizzle-orm';
import type { LetterType } from '../db/index.js';

/**
 * Letter types that can establish a public catalogue unit. C/T/E/N records are
 * supplementary media and are public only when attached to one of these roots.
 */
export const PUBLIC_CATALOGUE_LETTER_TYPES = ['L', 'P', 'V', 'A', 'D'] as const satisfies readonly LetterType[];

const PUBLIC_CATALOGUE_LETTER_TYPE_SET: ReadonlySet<string> = new Set(PUBLIC_CATALOGUE_LETTER_TYPES);
const PUBLIC_CATALOGUE_LETTER_TYPE_RANK = new Map<string, number>(
  PUBLIC_CATALOGUE_LETTER_TYPES.map((type, index) => [type, index]),
);

export function isPublicCatalogueLetterType(type: string): type is typeof PUBLIC_CATALOGUE_LETTER_TYPES[number] {
  return PUBLIC_CATALOGUE_LETTER_TYPE_SET.has(type);
}

function publicCatalogueLetterTypesSql() {
  const [firstType, ...remainingTypes] = PUBLIC_CATALOGUE_LETTER_TYPES;
  return remainingTypes.reduce(
    (typeList, catalogueType) => sql`${typeList}, ${catalogueType}`,
    sql`${firstType}`,
  );
}

export function publicCatalogueLetterTypeSql(type: SQLWrapper) {
  return sql`${type} = ANY(ARRAY[${publicCatalogueLetterTypesSql()}]::letter_type[])`;
}

/**
 * SQL ordering counterpart to selectPublicCatalogueRepresentative. The
 * exported type list is the single source of truth for both eligibility and
 * priority.
 */
export function publicCatalogueRepresentativeOrderSql(type: SQLWrapper) {
  return sql`array_position(ARRAY[${publicCatalogueLetterTypesSql()}]::letter_type[], ${type})`;
}

/** Unknown date components sort at the start of their known range.
 * Unit identity breaks ties, so every public chronological view agrees.
 */
export function publicCatalogueChronologySql(
  dateRaw: SQLWrapper,
  collectionId: SQLWrapper,
  typeSequence: SQLWrapper,
  descending = false,
) {
  return descending
    ? sql`REPLACE(UPPER(${dateRaw}), 'X', '0') DESC, ${dateRaw} DESC, ${collectionId} DESC, ${typeSequence} DESC`
    : sql`REPLACE(UPPER(${dateRaw}), 'X', '0') ASC, ${dateRaw} ASC, ${collectionId} ASC, ${typeSequence} ASC`;
}

export interface PublicCatalogueUnitRow {
  collectionId: string;
  dateRaw: string;
  typeSequence: string | number;
  type: string;
}

function publicCatalogueUnitKey(row: PublicCatalogueUnitRow): string {
  return `${row.collectionId}\u0000${row.dateRaw}\u0000${row.typeSequence}`;
}

export interface PublicCatalogueRepresentativeRow {
  id: string;
  type: string;
}

export function isPhotoOnlyCatalogueUnit(rows: readonly Pick<PublicCatalogueRepresentativeRow, 'type'>[]): boolean {
  return rows.length > 0 && rows.every((row) => row.type === 'P');
}

export function comparePublicCatalogueRepresentatives(
  left: PublicCatalogueRepresentativeRow,
  right: PublicCatalogueRepresentativeRow,
): number {
  const leftRank = PUBLIC_CATALOGUE_LETTER_TYPE_RANK.get(left.type)
    ?? PUBLIC_CATALOGUE_LETTER_TYPES.length;
  const rightRank = PUBLIC_CATALOGUE_LETTER_TYPE_RANK.get(right.type)
    ?? PUBLIC_CATALOGUE_LETTER_TYPES.length;

  return leftRank - rightRank || left.id.localeCompare(right.id);
}

/**
 * Pick the one stable public identity for a correspondence unit.
 */
export function selectPublicCatalogueRepresentative<T extends PublicCatalogueRepresentativeRow>(
  rows: readonly T[],
): T | undefined {
  return rows
    .filter((row) => isPublicCatalogueLetterType(row.type))
    .reduce<T | undefined>((selected, row) => (
      !selected || comparePublicCatalogueRepresentatives(row, selected) < 0
        ? row
        : selected
    ), undefined);
}

/**
 * Retain catalogue roots and their published companion rows. Callers must pass
 * only rows whose visibility has already been established as PUBLISHED.
 */
export function retainRowsWithPublicCatalogueRoot<T extends PublicCatalogueUnitRow>(rows: readonly T[]): T[] {
  const publicUnitKeys = new Set(
    rows
      .filter((row) => isPublicCatalogueLetterType(row.type))
      .map(publicCatalogueUnitKey),
  );

  return rows.filter((row) => publicUnitKeys.has(publicCatalogueUnitKey(row)));
}

/**
 * Collapse published catalogue rows to one representative per unit while
 * preserving the order in which units first appeared.
 */
export function retainPublicCatalogueRepresentatives<
  T extends PublicCatalogueUnitRow & PublicCatalogueRepresentativeRow,
>(rows: readonly T[]): T[] {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    if (!isPublicCatalogueLetterType(row.type)) continue;
    const key = publicCatalogueUnitKey(row);
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  return [...groups.values()]
    .map(selectPublicCatalogueRepresentative)
    .filter((row): row is T => row !== undefined);
}
