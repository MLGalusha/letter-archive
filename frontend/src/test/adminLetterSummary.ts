import type {
  AdminLetterPageCountsByType,
  AdminLetterSummary,
} from "../types/Letter";

export function emptyAdminLetterPageCounts(): AdminLetterPageCountsByType {
  return {
    letter: 0,
    photo: 0,
    cover: 0,
    telegram: 0,
    card: 0,
    ephemera: 0,
    voice: 0,
    article: 0,
    diary: 0,
  };
}

export function makeAdminLetterSummary(
  overrides: Partial<AdminLetterSummary> = {},
): AdminLetterSummary {
  const summary: AdminLetterSummary = {
    id: "letter-1",
    title: "Test Letter",
    collectionCode: "009",
    primarySourceRevision: 0,
    primaryImageType: "letter",
    pageCountsByType: {
      ...emptyAdminLetterPageCounts(),
      letter: 1,
    },
    metadata: {
      sender: "Alice",
      recipient: "Bob",
      dateRaw: "19470810",
    },
    visibility: "HIDDEN",
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: "AI_DRAFT",
    metadataContentStatus: "AI_DRAFT",
    extraContentStatus: "EMPTY",
    photoDescriptionStatus: "EMPTY",
    metadataJobStatus: "PENDING",
    transcriptDigest: "a".repeat(64),
    transcriptConfirmed: false,
    flagged: false,
    createdAt: "2026-03-09T12:00:00.000Z",
    updatedAt: "2026-03-09T12:00:00.000Z",
  };

  return {
    ...summary,
    ...overrides,
    metadata: {
      ...summary.metadata,
      ...overrides.metadata,
    },
    pageCountsByType: {
      ...summary.pageCountsByType,
      ...overrides.pageCountsByType,
    },
  };
}
