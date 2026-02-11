import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAdjacentLetters, type AdjacentLettersResponse } from '../../api/letters';
import Icon from '../common/Icon';
import './LetterNav.css';

interface LetterNavProps {
  letterId: string;
}

export default function LetterNav({ letterId }: LetterNavProps) {
  const navigate = useNavigate();
  const [adjacent, setAdjacent] = useState<AdjacentLettersResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAdjacent() {
      setLoading(true);
      try {
        const data = await getAdjacentLetters(letterId);
        setAdjacent(data);
      } catch (err) {
        console.error('Failed to fetch adjacent letters:', err);
        setAdjacent(null);
      } finally {
        setLoading(false);
      }
    }

    fetchAdjacent();
  }, [letterId]);

  const handlePrev = useCallback(() => {
    if (adjacent?.prev) {
      navigate(`/letter/${adjacent.prev}`);
    }
  }, [adjacent?.prev, navigate]);

  const handleNext = useCallback(() => {
    if (adjacent?.next) {
      navigate(`/letter/${adjacent.next}`);
    }
  }, [adjacent?.next, navigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowLeft' && adjacent?.prev) {
        handlePrev();
      } else if (e.key === 'ArrowRight' && adjacent?.next) {
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [adjacent, handlePrev, handleNext]);

  if (loading) {
    return (
      <nav className="letter-nav loading">
        <span className="letter-nav-loading">Loading...</span>
      </nav>
    );
  }

  if (!adjacent || adjacent.total === 0) {
    return null;
  }

  return (
    <nav className="letter-nav" aria-label="Letter navigation">
      <button
        className="letter-nav-btn"
        onClick={handlePrev}
        disabled={!adjacent.prev}
        aria-label="Previous letter"
        title="Previous letter (Left arrow)"
      >
        <Icon name="arrow-left" size={16} />
        <span>Previous</span>
      </button>

      <span className="letter-nav-position">
        Letter {adjacent.position} of {adjacent.total}
      </span>

      <button
        className="letter-nav-btn"
        onClick={handleNext}
        disabled={!adjacent.next}
        aria-label="Next letter"
        title="Next letter (Right arrow)"
      >
        <span>Next</span>
        <Icon name="arrow-right" size={16} />
      </button>
    </nav>
  );
}
