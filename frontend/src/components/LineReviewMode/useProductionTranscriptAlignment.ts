import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  getProductionTranscriptAlignment,
  type ProductionTranscriptAlignmentEnvelope,
} from '../../api/admin/productionTranscriptAlignment';

export type ProductionAlignmentLoadStatus =
  | 'loading'
  | 'ready'
  | 'error';

interface AlignmentIdentity {
  letterId: string;
  primarySourceRevision: number;
  transcriptRevision?: number;
  transcriptChecksumSha256?: string;
}

interface CompleteAlignmentIdentity extends AlignmentIdentity {
  transcriptRevision: number;
  transcriptChecksumSha256: string;
}

export interface ProductionAlignmentGeometryExpectation {
  pageId: string;
  geometryRevision: number;
  geometryChecksumSha256: string;
  lineSegmentsChecksumSha256: string;
}

interface ProductionAlignmentState {
  identityKey: string;
  envelope: ProductionTranscriptAlignmentEnvelope | null;
  status: ProductionAlignmentLoadStatus;
  error: Error | null;
}

const MISSING_TRANSCRIPT_IDENTITY_ERROR = new Error(
  'Transcript placement requires a transcript revision and checksum',
);
const EMPTY_GEOMETRY_EXPECTATIONS:
readonly ProductionAlignmentGeometryExpectation[] = [];

export interface ProductionAlignmentController
  extends ProductionAlignmentState {
  refresh: () => Promise<boolean>;
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Failed to load transcript placement');
}

function completeIdentity(
  identity: AlignmentIdentity,
): CompleteAlignmentIdentity | null {
  if (
    !Number.isInteger(identity.transcriptRevision)
    || Number(identity.transcriptRevision) < 0
    || typeof identity.transcriptChecksumSha256 !== 'string'
    || identity.transcriptChecksumSha256.length === 0
  ) {
    return null;
  }
  return identity as CompleteAlignmentIdentity;
}

async function requestAlignment(
  identity: CompleteAlignmentIdentity,
  geometryExpectations: readonly ProductionAlignmentGeometryExpectation[],
  signal: AbortSignal,
): Promise<ProductionTranscriptAlignmentEnvelope> {
  const envelope = await getProductionTranscriptAlignment(
    identity.letterId,
    signal,
  );
  if (
    envelope.source.letterId !== identity.letterId
    || envelope.source.primarySourceRevision
      !== identity.primarySourceRevision
    || envelope.source.transcriptRevision
      !== identity.transcriptRevision
    || envelope.source.transcriptChecksumSha256
      !== identity.transcriptChecksumSha256
  ) {
    throw new Error(
      'Transcript placement belongs to an older letter source',
    );
  }
  const pageById = new Map(
    envelope.pages.map((page) => [page.pageId, page]),
  );
  for (const expected of geometryExpectations) {
    const page = pageById.get(expected.pageId);
    if (!page) {
      throw new Error(
        'Transcript placement is missing current page geometry',
      );
    }
    if (page.geometry.geometryRevision < expected.geometryRevision) {
      throw new Error(
        'Transcript placement belongs to older page geometry',
      );
    }
    if (
      page.geometry.geometryRevision === expected.geometryRevision
      && (
        (
          expected.geometryChecksumSha256.length > 0
          && page.geometry.geometryChecksumSha256
            !== expected.geometryChecksumSha256
        )
        || (
          expected.lineSegmentsChecksumSha256.length > 0
          && page.geometry.lineSegmentsChecksumSha256
            !== expected.lineSegmentsChecksumSha256
        )
      )
    ) {
      throw new Error(
        'Transcript placement conflicts with current page geometry',
      );
    }
  }
  return envelope;
}

/**
 * Owns the production alignment request lane.
 *
 * Every refresh supersedes the previous request. The sequence check remains
 * necessary even with AbortController because mocked clients, caches, and an
 * already-resolved response may not observe cancellation in time.
 */
export function useProductionTranscriptAlignment(
  letterId: string,
  primarySourceRevision: number,
  transcriptRevision?: number,
  transcriptChecksumSha256?: string,
  geometryExpectations:
  readonly ProductionAlignmentGeometryExpectation[] =
    EMPTY_GEOMETRY_EXPECTATIONS,
): ProductionAlignmentController {
  const identity = useMemo<AlignmentIdentity>(() => ({
    letterId,
    primarySourceRevision,
    transcriptRevision,
    transcriptChecksumSha256,
  }), [
    letterId,
    primarySourceRevision,
    transcriptRevision,
    transcriptChecksumSha256,
  ]);
  const identityKey = [
    letterId,
    primarySourceRevision,
    transcriptRevision ?? '',
    transcriptChecksumSha256 ?? '',
    ...geometryExpectations
      .map((page) => [
        page.pageId,
        page.geometryRevision,
        page.geometryChecksumSha256,
        page.lineSegmentsChecksumSha256,
      ].join('\u0001'))
      .sort(),
  ].join('\u0000');
  const verifiedIdentity = useMemo(
    () => completeIdentity(identity),
    [identity],
  );
  const requestSequenceRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [state, setState] = useState<ProductionAlignmentState>({
    identityKey,
    envelope: null,
    status: 'loading',
    error: null,
  });

  const beginRequest = useCallback(() => {
    if (!verifiedIdentity) return null;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    return {
      sequence,
      controller,
      promise: requestAlignment(
        verifiedIdentity,
        geometryExpectations,
        controller.signal,
      ),
    };
  }, [geometryExpectations, verifiedIdentity]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!verifiedIdentity) return false;
    setState({
      identityKey,
      envelope: null,
      status: 'loading',
      error: null,
    });
    const request = beginRequest();
    if (!request) return false;
    try {
      const envelope = await request.promise;
      const stillCurrent = (
        mountedRef.current
        && requestSequenceRef.current === request.sequence
      );
      if (!stillCurrent) return false;
      setState({
        identityKey,
        envelope,
        status: 'ready',
        error: null,
      });
      return true;
    } catch (error) {
      if (
        !mountedRef.current
        || requestSequenceRef.current !== request.sequence
      ) {
        return false;
      }
      const resolved = asError(error);
      if (resolved.name === 'AbortError') return false;
      setState({
        identityKey,
        envelope: null,
        status: 'error',
        error: resolved,
      });
      return false;
    } finally {
      if (activeControllerRef.current === request.controller) {
        activeControllerRef.current = null;
      }
    }
  }, [beginRequest, identityKey, verifiedIdentity]);

  useEffect(() => {
    // React StrictMode intentionally runs setup → cleanup → setup in
    // development. Reassert liveness here so the second setup can adopt its
    // response after the first setup's cleanup marked the hook unmounted.
    mountedRef.current = true;
    const request = beginRequest();
    if (!request) return;
    void request.promise.then((envelope) => {
      if (
        !mountedRef.current
        || requestSequenceRef.current !== request.sequence
      ) {
        return;
      }
      setState({
        identityKey,
        envelope,
        status: 'ready',
        error: null,
      });
    }).catch((error: unknown) => {
      if (
        !mountedRef.current
        || requestSequenceRef.current !== request.sequence
      ) {
        return;
      }
      const resolved = asError(error);
      if (resolved.name === 'AbortError') return;
      setState({
        identityKey,
        envelope: null,
        status: 'error',
        error: resolved,
      });
    }).finally(() => {
      if (activeControllerRef.current === request.controller) {
        activeControllerRef.current = null;
      }
    });
    return () => {
      requestSequenceRef.current += 1;
      request.controller.abort();
      if (activeControllerRef.current === request.controller) {
        activeControllerRef.current = null;
      }
    };
  }, [beginRequest, identityKey]);

  useEffect(() => () => {
    mountedRef.current = false;
    requestSequenceRef.current += 1;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
  }, []);

  let currentState: ProductionAlignmentState;
  if (!verifiedIdentity) {
    currentState = {
      identityKey,
      envelope: null,
      status: 'error',
      error: MISSING_TRANSCRIPT_IDENTITY_ERROR,
    };
  } else if (state.identityKey === identityKey) {
    currentState = state;
  } else {
    currentState = {
      identityKey,
      envelope: null,
      status: 'loading',
      error: null,
    };
  }

  return {
    ...currentState,
    refresh,
  };
}
