import { useState, useEffect, useRef } from 'react';

interface UseProgressiveImageResult {
  thumbLoaded: boolean;
  fullLoaded: boolean;
}

export function useProgressiveImage(thumbSrc: string, fullSrc: string): UseProgressiveImageResult {
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const fullImgRef = useRef<HTMLImageElement | null>(null);
  const thumbImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setThumbLoaded(false);
    setFullLoaded(false);

    let cancelled = false;

    // Load thumbnail
    const thumb = new Image();
    thumbImgRef.current = thumb;
    thumb.onload = () => {
      if (!cancelled) setThumbLoaded(true);
    };
    thumb.src = thumbSrc;
    // Handle already-cached thumbnails
    if (thumb.complete) {
      if (!cancelled) setThumbLoaded(true);
    }

    // Load full image
    const full = new Image();
    fullImgRef.current = full;
    full.onload = () => {
      if (!cancelled) setFullLoaded(true);
    };
    full.src = fullSrc;
    // Handle already-cached full images
    if (full.complete) {
      if (!cancelled) setFullLoaded(true);
    }

    return () => {
      cancelled = true;
      thumb.onload = null;
      full.onload = null;
      thumbImgRef.current = null;
      fullImgRef.current = null;
    };
  }, [thumbSrc, fullSrc]);

  return { thumbLoaded, fullLoaded };
}
