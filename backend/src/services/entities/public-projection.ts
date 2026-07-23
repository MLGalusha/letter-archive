import {
  and,
  eq,
  isNotNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';

/**
 * Public entity data must be either explicitly confirmed or part of the
 * letter's exact committed extraction revision. Ambiguous legacy NULL rows
 * remain available to admins but cannot leak from failed partial runs.
 */
export function publicEntityProjectionSql(
  confirmedAt: SQLWrapper,
  projectionRevision: SQLWrapper,
  committedRevision: SQLWrapper,
  committedJson: SQLWrapper,
): SQL<boolean> {
  const trustedProjection = or(
    isNotNull(confirmedAt),
    and(
      isNotNull(projectionRevision),
      eq(projectionRevision, committedRevision),
      isNotNull(committedJson),
    ),
  );

  return sql<boolean>`COALESCE(${trustedProjection}, FALSE)`;
}

export interface PublicEntityProjectionState {
  confirmedAt: Date | string | null | undefined;
  projectionRevision: number | null | undefined;
  committedRevision: number;
  committedJson: unknown;
}

/**
 * In-memory counterpart used when an ORM relation is materialized before the
 * public DTO boundary.
 */
export function isPublicEntityProjection(
  state: PublicEntityProjectionState,
): boolean {
  return state.confirmedAt != null || (
    state.projectionRevision != null
    && state.projectionRevision === state.committedRevision
    && state.committedJson != null
  );
}
