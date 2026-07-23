import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CollectionInfo } from "../../api/collections";
import type { HeaderScrubberProps } from "../HeaderScrubber/HeaderScrubber";
import { listNavigableCollections } from "./collectionNavigation";

interface AdjacentCollections {
  prev: CollectionInfo | null;
  next: CollectionInfo | null;
}

interface CollectionNavigation {
  scrubberProps: HeaderScrubberProps | null;
  adjacent: AdjacentCollections;
}

const NO_ADJACENT_COLLECTIONS: AdjacentCollections = {
  prev: null,
  next: null,
};

/**
 * Loads one fresh public collection list for both header and swipe navigation.
 * Results are tied to the route key that requested them, so a route change
 * cannot expose the previous collection's neighbors while the next request is
 * pending or after it fails.
 */
export default function useCollectionNavigation(
  collectionCode: string | undefined,
): CollectionNavigation {
  const navigate = useNavigate();
  const [routeRequest, setRouteRequest] = useState({
    collectionCode,
    generation: 0,
  });
  if (routeRequest.collectionCode !== collectionCode) {
    setRouteRequest({
      collectionCode,
      generation: routeRequest.generation + 1,
    });
  }
  const [loaded, setLoaded] = useState<{
    collectionCode: string;
    generation: number;
    collections: CollectionInfo[];
  } | null>(null);

  useEffect(() => {
    const requestedCollectionCode = routeRequest.collectionCode;
    if (!requestedCollectionCode) return;

    let cancelled = false;
    listNavigableCollections()
      .then((collections) => {
        if (!cancelled) {
          setLoaded({
            collectionCode: requestedCollectionCode,
            generation: routeRequest.generation,
            collections,
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [routeRequest]);

  const collections = loaded !== null
    && loaded.collectionCode === collectionCode
    && routeRequest.collectionCode === collectionCode
    && loaded.generation === routeRequest.generation
    ? loaded.collections
    : null;

  const currentIdx = useMemo(
    () => (collections && collectionCode
      ? collections.findIndex((collection) => collection.collectionCode === collectionCode)
      : -1),
    [collections, collectionCode],
  );
  const total = collections?.length ?? 0;
  const position = currentIdx + 1;

  const navigateToIndex = useCallback((index: number) => {
    if (!collections || index < 0 || index >= collections.length) return;
    navigate(`/collections/${collections[index].collectionCode}`);
  }, [collections, navigate]);

  const handleNavigate = useCallback((targetPosition: number) => {
    navigateToIndex(targetPosition - 1);
  }, [navigateToIndex]);

  const handlePrev = useCallback(() => {
    if (total <= 1) return;
    navigateToIndex(currentIdx === 0 ? total - 1 : currentIdx - 1);
  }, [currentIdx, navigateToIndex, total]);

  const handleNext = useCallback(() => {
    if (total <= 1) return;
    navigateToIndex(currentIdx === total - 1 ? 0 : currentIdx + 1);
  }, [currentIdx, navigateToIndex, total]);

  const adjacent = useMemo<AdjacentCollections>(() => {
    if (!collections || currentIdx === -1 || total <= 1) {
      return NO_ADJACENT_COLLECTIONS;
    }

    return {
      prev: collections[(currentIdx - 1 + total) % total],
      next: collections[(currentIdx + 1) % total],
    };
  }, [collections, currentIdx, total]);

  const scrubberProps = useMemo<HeaderScrubberProps | null>(() => {
    if (!collections || currentIdx === -1 || total <= 1) return null;

    return {
      position,
      total,
      onNavigate: handleNavigate,
      onPrev: handlePrev,
      onNext: handleNext,
      wrap: true,
      ariaLabel: `Collection ${position} of ${total}`,
    };
  }, [collections, currentIdx, handleNavigate, handleNext, handlePrev, position, total]);

  return useMemo(() => ({ scrubberProps, adjacent }), [adjacent, scrubberProps]);
}
