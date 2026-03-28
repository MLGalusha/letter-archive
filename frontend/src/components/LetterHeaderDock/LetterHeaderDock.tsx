import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { AdjacentLettersResponse } from "../../api/letters";
import useCollectionLetters from "./useCollectionLetters";
import HeaderScrubber from "../HeaderScrubber/HeaderScrubber";

interface LetterHeaderDockProps {
  adjacent: AdjacentLettersResponse;
  letterId: string;
}

export default function LetterHeaderDock({ adjacent, letterId }: LetterHeaderDockProps) {
  const navigate = useNavigate();
  const letters = useCollectionLetters(adjacent.collectionCode);

  const pos = adjacent.position ?? 1;
  const total = adjacent.total;

  const currentIdx = useMemo(
    () => (letters ? letters.findIndex((l) => l.id === letterId) : -1),
    [letters, letterId],
  );

  const handleNavigate = useCallback(
    (targetPos: number) => {
      if (!letters || currentIdx === -1 || targetPos === pos) return;
      const targetIdx = currentIdx + (targetPos - pos);
      if (targetIdx >= 0 && targetIdx < letters.length) {
        navigate(`/letter/${letters[targetIdx].id}`);
      }
    },
    [letters, currentIdx, pos, navigate],
  );

  const handlePrev = useCallback(() => {
    if (adjacent.prev) navigate(`/letter/${adjacent.prev.id}`);
  }, [adjacent.prev, navigate]);

  const handleNext = useCallback(() => {
    if (adjacent.next) navigate(`/letter/${adjacent.next.id}`);
  }, [adjacent.next, navigate]);

  return (
    <HeaderScrubber
      position={pos}
      total={total}
      onNavigate={handleNavigate}
      onPrev={handlePrev}
      onNext={handleNext}
      ariaLabel={`Letter ${pos} of ${total}`}
    />
  );
}
