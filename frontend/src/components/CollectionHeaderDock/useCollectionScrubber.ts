import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { CollectionInfo } from "../../api/collections";
import type { HeaderScrubberProps } from "../HeaderScrubber/HeaderScrubber";
import { fetchAllCollections, getCachedCollections } from "./collectionCache";

export default function useCollectionScrubber(
  collectionCode: string | undefined,
): HeaderScrubberProps | null {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionInfo[] | null>(getCachedCollections());

  useEffect(() => {
    fetchAllCollections().then(setCollections).catch(() => {});
  }, []);

  const currentIdx = useMemo(
    () => (collections && collectionCode
      ? collections.findIndex((c) => c.collectionCode === collectionCode)
      : -1),
    [collections, collectionCode],
  );

  const total = collections?.length ?? 0;
  const pos = currentIdx + 1;

  const handleNavigate = useCallback(
    (targetPos: number) => {
      if (!collections) return;
      const targetIdx = targetPos - 1;
      if (targetIdx >= 0 && targetIdx < collections.length) {
        navigate(`/collections/${collections[targetIdx].collectionCode}`);
      }
    },
    [collections, navigate],
  );

  const handlePrev = useCallback(() => {
    if (!collections || total <= 1) return;
    const prevIdx = currentIdx === 0 ? total - 1 : currentIdx - 1;
    navigate(`/collections/${collections[prevIdx].collectionCode}`);
  }, [collections, currentIdx, total, navigate]);

  const handleNext = useCallback(() => {
    if (!collections || total <= 1) return;
    const nextIdx = currentIdx === total - 1 ? 0 : currentIdx + 1;
    navigate(`/collections/${collections[nextIdx].collectionCode}`);
  }, [collections, currentIdx, total, navigate]);

  return useMemo(() => {
    if (!collections || total <= 1 || currentIdx === -1) return null;
    return {
      position: pos,
      total,
      onNavigate: handleNavigate,
      onPrev: handlePrev,
      onNext: handleNext,
      wrap: true,
      ariaLabel: `Collection ${pos} of ${total}`,
    };
  }, [collections, pos, total, currentIdx, handleNavigate, handlePrev, handleNext]);
}
