import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getCurrentRotationGeometryProposal,
  type CurrentRotationGeometryProposal,
} from '../../api/admin/pageGeometryProposals';

export interface RotationProposalIdentity {
  pageId: string;
  primarySourceRevision: number;
  sourceChecksumSha256: string;
  geometryRevision: number;
  geometryChecksumSha256: string;
  lineSegmentsChecksumSha256: string;
}

export type RotationProposalLoadStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'error';

export interface RotationProposalController {
  proposal: CurrentRotationGeometryProposal | null;
  status: RotationProposalLoadStatus;
  error: Error | null;
}

interface RotationProposalState extends RotationProposalController {
  identityKey: string;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function completeIdentity(
  identity: RotationProposalIdentity | null,
): RotationProposalIdentity | null {
  if (
    !identity
    || identity.pageId.length === 0
    || !Number.isInteger(identity.primarySourceRevision)
    || identity.primarySourceRevision < 0
    || !SHA256_PATTERN.test(identity.sourceChecksumSha256)
    || !Number.isInteger(identity.geometryRevision)
    || identity.geometryRevision < 0
    || !SHA256_PATTERN.test(identity.geometryChecksumSha256)
    || !SHA256_PATTERN.test(identity.lineSegmentsChecksumSha256)
  ) {
    return null;
  }
  return identity;
}

function proposalMatchesIdentity(
  proposal: CurrentRotationGeometryProposal,
  identity: RotationProposalIdentity,
): boolean {
  const artifact = proposal.artifact;
  return (
    artifact.pageId === identity.pageId
    && artifact.source.primarySourceRevision
      === identity.primarySourceRevision
    && artifact.source.sourceChecksumSha256
      === identity.sourceChecksumSha256
    && artifact.source.baseGeometryRevision
      === identity.geometryRevision
    && artifact.source.baseGeometryChecksumSha256
      === identity.geometryChecksumSha256
    && artifact.source.baseLineSegmentsChecksumSha256
      === identity.lineSegmentsChecksumSha256
  );
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Failed to load sideways candidates');
}

/**
 * Loads the immutable sideways-text proposal for one exact page geometry.
 *
 * The identity check is repeated in the browser so an older response can
 * never be drawn over newer human edits, even when a cache or test double
 * ignores request cancellation.
 */
export function useRotationGeometryProposal(
  identity: RotationProposalIdentity | null,
): RotationProposalController {
  const identityKey = identity
    ? [
      identity.pageId,
      identity.primarySourceRevision,
      identity.sourceChecksumSha256,
      identity.geometryRevision,
      identity.geometryChecksumSha256,
      identity.lineSegmentsChecksumSha256,
    ].join('\u0000')
    : '';
  const verifiedIdentity = useMemo(
    () => completeIdentity(identity),
    // The key contains every field in the revision-bound identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identityKey],
  );
  const requestSequenceRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<RotationProposalState>({
    identityKey,
    proposal: null,
    status: verifiedIdentity ? 'loading' : 'idle',
    error: null,
  });

  useEffect(() => {
    requestSequenceRef.current += 1;
    const sequence = requestSequenceRef.current;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;

    if (!verifiedIdentity) {
      return;
    }

    const controller = new AbortController();
    activeControllerRef.current = controller;
    void getCurrentRotationGeometryProposal(
      verifiedIdentity.pageId,
      controller.signal,
    ).then(({ proposal }) => {
      if (requestSequenceRef.current !== sequence) return;
      if (proposal && !proposalMatchesIdentity(proposal, verifiedIdentity)) {
        setState({
          identityKey,
          proposal: null,
          status: 'stale',
          error: null,
        });
        return;
      }
      setState({
        identityKey,
        proposal,
        status: 'ready',
        error: null,
      });
    }).catch((error: unknown) => {
      if (requestSequenceRef.current !== sequence) return;
      const resolved = asError(error);
      if (resolved.name === 'AbortError') return;
      setState({
        identityKey,
        proposal: null,
        status: 'error',
        error: resolved,
      });
    }).finally(() => {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    });

    return () => {
      requestSequenceRef.current += 1;
      controller.abort();
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
      }
    };
  }, [identityKey, verifiedIdentity]);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  if (!verifiedIdentity) {
    return {
      proposal: null,
      status: 'idle',
      error: null,
    };
  }
  if (state.identityKey !== identityKey) {
    return {
      proposal: null,
      status: 'loading',
      error: null,
    };
  }
  return state;
}
