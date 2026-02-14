interface SearchableEntity {
  canonicalName: string;
  aliases?: string[] | null;
}

export function filterEntitiesBySearch<T extends SearchableEntity>(
  entities: T[],
  searchQuery: string,
): T[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return entities;

  return entities.filter(
    (entity) =>
      entity.canonicalName.toLowerCase().includes(query) ||
      entity.aliases?.some((alias) => alias.toLowerCase().includes(query)),
  );
}

export function parseAliasInput(aliasInput: string): string[] {
  return aliasInput
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export function toggleSelectedId(
  selectedIds: Set<string>,
  id: string,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}
