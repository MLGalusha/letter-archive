import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { savePageLineSegments } from '../../api/admin/letters';
import type { LineSegment } from '../../types/Letter';

export interface SegmentPersistenceTarget {
  letterId: string;
  pageId: string;
  letterPageIndex: number;
  primarySourceRevision: number;
  sourceChecksum: string | null;
}

interface Options {
  target: SegmentPersistenceTarget | null;
  /** Immutable editor draft identity; changes advance the local save revision. */
  draft: readonly LineSegment[];
  isDirty: boolean;
  getSegmentsForSave: () => LineSegment[];
  blocked: boolean;
  onSaved: (segments: LineSegment[], target: SegmentPersistenceTarget) => void;
  onError: (error: unknown, message: string) => unknown;
}

interface Snapshot extends Options {
  identity: string;
  revision: number;
  epoch: number;
}

/**
 * Owns one committed editor draft's persistence. Successful flushes drain newer
 * revisions before authorizing a transition. Changing source/page, blocking
 * mutations, or unmounting revokes outstanding results (including clean flushes).
 */
export function useSegmentPersistence(options: Options) {
  const identity = JSON.stringify(options.target);
  const latest = useRef<Snapshot | null>(null);
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const active = useRef<{ epoch: number; lifetime: number; identity: string; promise: Promise<boolean> } | null>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    lifetime.current += 1;
    return () => { mounted.current = false; latest.current = null; };
  }, []);

  // Publish only committed state, never a render that React might abandon.
  useLayoutEffect(() => {
    const previous = latest.current;
    latest.current = {
      ...options,
      identity,
      revision: (previous?.revision ?? 0) + (
        previous?.draft !== options.draft || previous.identity !== identity ? 1 : 0
      ),
      epoch: (previous?.epoch ?? 0) + (
        previous?.identity !== identity || previous.blocked !== options.blocked ? 1 : 0
      ),
    };
  });

  const captureGuard = useCallback(() => {
    const epoch = latest.current?.epoch;
    const session = lifetime.current;
    return () => mounted.current && lifetime.current === session
      && !latest.current?.blocked && latest.current?.epoch === epoch;
  }, []);

  const flush = useCallback((failureMessage = 'Failed to save segment edits'): Promise<boolean> => {
    const initial = latest.current;
    if (!mounted.current || !initial || initial.blocked) return Promise.resolve(false);
    const pending = active.current;
    if (pending?.epoch === initial.epoch && pending.lifetime === lifetime.current) return pending.promise;
    if (!pending && (!initial.target || !initial.isDirty)) return Promise.resolve(true);
    const isCurrent = captureGuard();

    const promise = (async () => {
      // Revocation prevents acknowledgments, but cannot cancel a server write.
      // Drain the old transport before sending a newer draft for the same source.
      if (pending) {
        await pending.promise;
        // A clean different page only waits for transport ordering. For the same
        // source, an undo can be locally clean while the revoked write still
        // changed the server, so persist that restored snapshot below.
        if (isCurrent() && !latest.current!.isDirty && latest.current!.identity !== pending.identity) return true;
      }
      while (isCurrent()) {
        const state = latest.current!;
        if (!state.target) return true;
        const target = state.target;
        const revision = state.revision;
        const segments = state.getSegmentsForSave();
        try {
          await savePageLineSegments(target.pageId, segments, {
            primarySourceRevision: target.primarySourceRevision,
            sourceChecksum: target.sourceChecksum,
          });
        } catch (error) {
          if (isCurrent()) latest.current!.onError(error, failureMessage);
          return false;
        }
        if (!isCurrent()) return false;
        const current = latest.current!;
        if (current.revision !== revision) continue;

        // Acknowledge only the exact committed revision that reached the server.
        latest.current = { ...current, isDirty: false };
        current.onSaved(segments, target);
        return true;
      }
      return false;
    })();
    active.current = { epoch: initial.epoch, lifetime: lifetime.current, identity: initial.identity, promise };
    const release = () => {
      if (active.current?.promise === promise) active.current = null;
    };
    void promise.then(release, release);
    return promise;
  }, [captureGuard]);

  const hasTarget = options.target !== null;
  useEffect(() => {
    if (!options.isDirty || options.blocked || !hasTarget) return;
    const timer = setTimeout(() => { void flush(); }, 1500);
    return () => clearTimeout(timer);
  }, [identity, options.draft, options.isDirty, options.blocked, hasTarget, flush]);

  return { flush, captureGuard };
}
