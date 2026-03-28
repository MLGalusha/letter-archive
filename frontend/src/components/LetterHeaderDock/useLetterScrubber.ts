import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { AdjacentLettersResponse } from "../../api/letters";
import type { HeaderScrubberProps } from "../HeaderScrubber/HeaderScrubber";
import useCollectionLetters from "./useCollectionLetters";

export default function useLetterScrubber(
  adjacent: AdjacentLettersResponse | null,
  letterId: string | undefined,
): HeaderScrubberProps | null {
  const navigate = useNavigate();
  const letters = useCollectionLetters(adjacent?.collectionCode ?? "");

  const currentIdx = useMemo(
    () => (letters && letterId ? letters.findIndex((l) => l.id === letterId) : -1),
    [letters, letterId],
  );

  // Use letters array for position/total when loaded, fall back to adjacent API
  const total = letters ? letters.length : (adjacent?.total ?? 0);
  const pos = currentIdx >= 0 ? currentIdx + 1 : (adjacent?.position ?? 1);

  const handleNavigate = useCallback(
    (targetPos: number) => {
      if (!letters || targetPos === pos) return;
      const targetIdx = targetPos - 1;
      if (targetIdx >= 0 && targetIdx < letters.length) {
        navigate(`/letter/${letters[targetIdx].id}`);
      }
    },
    [letters, pos, navigate],
  );

  const handlePrev = useCallback(() => {
    if (!letters || total <= 1) return;
    if (currentIdx >= 0) {
      const prevIdx = currentIdx === 0 ? letters.length - 1 : currentIdx - 1;
      navigate(`/letter/${letters[prevIdx].id}`);
    } else if (adjacent?.prev) {
      navigate(`/letter/${adjacent.prev.id}`);
    }
  }, [letters, currentIdx, total, adjacent?.prev, navigate]);

  const handleNext = useCallback(() => {
    if (!letters || total <= 1) return;
    if (currentIdx >= 0) {
      const nextIdx = currentIdx === letters.length - 1 ? 0 : currentIdx + 1;
      navigate(`/letter/${letters[nextIdx].id}`);
    } else if (adjacent?.next) {
      navigate(`/letter/${adjacent.next.id}`);
    }
  }, [letters, currentIdx, total, adjacent?.next, navigate]);

  return useMemo(() => {
    if (!adjacent || total <= 1) return null;
    return {
      position: pos,
      total,
      onNavigate: handleNavigate,
      onPrev: handlePrev,
      onNext: handleNext,
      wrap: true,
      ariaLabel: `Letter ${pos} of ${total}`,
    };
  }, [adjacent, pos, total, handleNavigate, handlePrev, handleNext]);
}
