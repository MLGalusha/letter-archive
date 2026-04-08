import { memo, useState, useRef, useEffect, useCallback } from "react";
import type { LetterImage } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { useProgressiveImage } from "../../hooks/useProgressiveImage";
import { Icon } from "../common";
import "./LetterViewer.css";

// ============================================================================
// CONSTANTS
// ============================================================================

const STORAGE_KEY = "letterViewerState";
const MIN_SCALE = 1;
const MAX_SCALE = 50;
const ZOOM_TRANSITION_MS = 150;

// ============================================================================
// TYPES
// ============================================================================

interface ImageViewState {
  scale: number;
  position: { x: number; y: number };
}

interface StoredState {
  letterId: string;
  images: Record<string, ImageViewState>;
  splitRatio?: number; // Used by ResizableSplitPane
}

interface LetterViewerProps {
  images: LetterImage[];
  letterId?: string;
  showOnlyLetterPages?: boolean;
  onPageChange?: (index: number, image: LetterImage) => void;
  onImageClick?: (pageIndex: number) => void;
  getImageAlt?: (image: LetterImage) => string;
  variant?: "panel" | "lightbox";
  initialIndex?: number;
}

// ============================================================================
// LOCALSTORAGE HELPERS
// ============================================================================

function loadStoredState(): StoredState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Failed to load letter viewer state:", e);
  }
  return null;
}

function saveStoredState(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to save letter viewer state:", e);
  }
}

function getImageKey(image: LetterImage, index: number): string {
  return image.id || `image-${index}`;
}

function getInitialStateForLetter(
  letterId: string | undefined,
  images: LetterImage[],
  currentIndex: number
): { scale: number; position: { x: number; y: number } } {
  if (!letterId) {
    return { scale: 1, position: { x: 0, y: 0 } };
  }

  const stored = loadStoredState();
  if (stored && stored.letterId === letterId) {
    const imageKey = getImageKey(images[currentIndex], currentIndex);
    const imageState = stored.images[imageKey];
    if (imageState) {
      return { scale: imageState.scale, position: imageState.position };
    }
  }

  return { scale: 1, position: { x: 0, y: 0 } };
}

// ============================================================================
// COMPONENT
// ============================================================================

const LetterViewer = memo(function LetterViewer({
  images,
  letterId,
  showOnlyLetterPages = false,
  onPageChange,
  onImageClick,
  getImageAlt,
  variant = "panel",
  initialIndex = 0,
}: LetterViewerProps) {
  // Filter images if needed
  const displayImages = showOnlyLetterPages
    ? images.filter((img) => img.type === "letter")
    : images;

  const [currentImageIndex, setCurrentImageIndex] = useState(initialIndex);

  // Initialize scale and position — lightbox always starts at 1x, panel restores from localStorage
  const [scale, setScale] = useState(() => {
    if (variant === "lightbox") return 1;
    const initial = getInitialStateForLetter(letterId, displayImages, 0);
    return initial.scale;
  });
  const [position, setPosition] = useState(() => {
    if (variant === "lightbox") return { x: 0, y: 0 };
    const initial = getInitialStateForLetter(letterId, displayImages, 0);
    return initial.position;
  });

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isSliderDragging, setIsSliderDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const sliderTrackRef = useRef<HTMLDivElement>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const mouseDownOnImage = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // Use refs to avoid stale closures in event handlers
  const scaleRef = useRef(scale);
  const positionRef = useRef(position);
  const letterIdRef = useRef(letterId);
  const displayImagesRef = useRef(displayImages);
  const currentImageIndexRef = useRef(currentImageIndex);

  // Keep refs in sync
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    letterIdRef.current = letterId;
  }, [letterId]);

  useEffect(() => {
    displayImagesRef.current = displayImages;
  }, [displayImages]);

  useEffect(() => {
    currentImageIndexRef.current = currentImageIndex;
  }, [currentImageIndex]);

  const currentImage = displayImages[currentImageIndex];

  // Progressive image loading (blur-up)
  // Lightbox: 800px mid (matches carousel cache → instant), full-res always loads in background
  // Panel: 1200px initial, full-res only on zoom
  const initialWidth = variant === "lightbox" ? 800 : 1200;
  const thumbSrc = getImageUrl(currentImage.imageUrl, { width: 32 });
  const midSrc = getImageUrl(currentImage.imageUrl, { width: initialWidth });
  const fullSrc = (variant === "lightbox" || scale > 1)
    ? getImageUrl(currentImage.imageUrl)
    : midSrc;
  const { fullLoaded, midLoaded } = useProgressiveImage({
    thumbSrc,
    midSrc,
    fullSrc,
    idleUpgrade: variant === "panel",
    context: variant === "lightbox" ? 'viewer-lightbox' : 'viewer-panel',
  });
  const viewerReady = fullLoaded || midLoaded;

  // Preload adjacent images so page navigation feels instant
  useEffect(() => {
    if (displayImages.length <= 1) return;
    const nextIdx = (currentImageIndex + 1) % displayImages.length;
    const prevIdx = (currentImageIndex - 1 + displayImages.length) % displayImages.length;
    const toPreload = [displayImages[nextIdx], displayImages[prevIdx]].filter(Boolean);
    const imgs: HTMLImageElement[] = [];
    for (const img of toPreload) {
      const el = new Image();
      el.src = getImageUrl(img.imageUrl, { width: initialWidth });
      imgs.push(el);
    }
    return () => { for (const el of imgs) el.onload = null; };
  }, [currentImageIndex, displayImages, initialWidth]);

  // ============================================================================
  // PERSISTENCE: Save state to localStorage
  // ============================================================================

  const saveCurrentImageState = useCallback(() => {
    if (!letterIdRef.current) return;

    const images = displayImagesRef.current;
    const index = currentImageIndexRef.current;
    if (!images[index]) return;

    const imageKey = getImageKey(images[index], index);
    const stored = loadStoredState();

    const newState: StoredState = {
      letterId: letterIdRef.current,
      images: stored?.letterId === letterIdRef.current ? { ...stored.images } : {},
    };

    newState.images[imageKey] = {
      scale: scaleRef.current,
      position: positionRef.current,
    };

    saveStoredState(newState);
  }, []);

  // Save state when scale or position changes (debounced via effect)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveCurrentImageState();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [scale, position, saveCurrentImageState]);

  // Handle letter change - clear storage if different letter
  useEffect(() => {
    const stored = loadStoredState();
    if (stored && letterId && stored.letterId !== letterId) {
      // Different letter - clear old state and start fresh
      saveStoredState({ letterId, images: {} });
    } else if (letterId && !stored) {
      // No stored state - initialize for this letter
      saveStoredState({ letterId, images: {} });
    }
  }, [letterId]);

  // Load state when changing images within the same letter
  // Lightbox always resets to 1x; panel restores from localStorage
  useEffect(() => {
    if (!letterId || variant === "lightbox") {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      return;
    }

    const stored = loadStoredState();
    if (stored && stored.letterId === letterId && displayImages[currentImageIndex]) {
      const imageKey = getImageKey(displayImages[currentImageIndex], currentImageIndex);
      const imageState = stored.images[imageKey];
      if (imageState) {
        setScale(imageState.scale);
        setPosition(imageState.position);
        return;
      }
    }

    // No saved state for this image - reset to defaults
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [currentImageIndex, letterId, displayImages, variant]);

  // Notify parent of page changes
  useEffect(() => {
    if (onPageChange && displayImages[currentImageIndex]) {
      onPageChange(currentImageIndex, displayImages[currentImageIndex]);
    }
  }, [currentImageIndex, displayImages, onPageChange]);

  // ============================================================================
  // ZOOM HELPERS
  // ============================================================================

  // Apply zoom while maintaining view center
  const applyZoom = useCallback((newScale: number, animate: boolean) => {
    const clampedScale = Math.min(Math.max(MIN_SCALE, newScale), MAX_SCALE);

    if (animate) {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), ZOOM_TRANSITION_MS);
    }

    // Adjust position to maintain view center
    const oldScale = scaleRef.current;
    if (oldScale !== clampedScale) {
      const ratio = clampedScale / oldScale;
      setPosition((prev) => ({
        x: prev.x * ratio,
        y: prev.y * ratio,
      }));
    }

    setScale(clampedScale);

    // Reset position if back to 1x
    if (clampedScale === 1) {
      setPosition({ x: 0, y: 0 });
    }
  }, []);

  // ============================================================================
  // SLIDER HANDLERS
  // ============================================================================

  const getScaleFromSliderPosition = useCallback((clientX: number): number => {
    if (!sliderTrackRef.current) return MIN_SCALE;

    const rect = sliderTrackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return MIN_SCALE + percent * (MAX_SCALE - MIN_SCALE);
  }, []);

  const handleSliderClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Don't handle if we're ending a drag
      if (isSliderDragging) return;

      const newScale = getScaleFromSliderPosition(e.clientX);
      applyZoom(newScale, true); // Animate on click
    },
    [isSliderDragging, getScaleFromSliderPosition, applyZoom]
  );

  const handleSliderMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsSliderDragging(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const newScale = getScaleFromSliderPosition(moveEvent.clientX);
        applyZoom(newScale, false); // No animation during drag
      };

      const handleMouseUp = () => {
        setIsSliderDragging(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [getScaleFromSliderPosition, applyZoom]
  );

  // ============================================================================
  // WHEEL ZOOM
  // ============================================================================

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Handle Ctrl/Cmd+wheel for zoom
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();

        // Multiplicative zoom: speed increases proportionally with current scale
        const factor = Math.pow(1.01, -e.deltaY);
        const currentScale = scaleRef.current;
        const newScale = Math.min(Math.max(MIN_SCALE, currentScale * factor), MAX_SCALE);

        applyZoom(newScale, false);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [applyZoom]);

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  const nextImage = useCallback(() => {
    // Save current state before switching
    saveCurrentImageState();
    setCurrentImageIndex((prev) => (prev + 1) % displayImages.length);
  }, [displayImages.length, saveCurrentImageState]);

  const prevImage = useCallback(() => {
    // Save current state before switching
    saveCurrentImageState();
    setCurrentImageIndex(
      (prev) => (prev - 1 + displayImages.length) % displayImages.length
    );
  }, [displayImages.length, saveCurrentImageState]);

  // Refs for use in native touch handlers (avoids stale closures)
  const nextImageRef = useRef(nextImage);
  nextImageRef.current = nextImage;
  const prevImageRef = useRef(prevImage);
  prevImageRef.current = prevImage;

  // ============================================================================
  // IMAGE DRAG/PAN HANDLERS
  // ============================================================================

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    mouseDownOnImage.current = (e.target as HTMLElement).tagName === 'IMG';
    if (scale === 1) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(false);
    // Fire onImageClick only if mousedown AND mouseup were on the <img> with no drag
    if (onImageClick && mouseDownPos.current && mouseDownOnImage.current
        && (e.target as HTMLElement).tagName === 'IMG') {
      const dx = e.clientX - mouseDownPos.current.x;
      const dy = e.clientY - mouseDownPos.current.y;
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        onImageClick(currentImageIndex);
      }
    }
    mouseDownPos.current = null;
    mouseDownOnImage.current = false;
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  // ============================================================================
  // NATIVE TOUCH HANDLERS (pinch-to-zoom, double-tap, pan)
  // iOS Safari requires native listeners with { passive: false } for preventDefault
  // ============================================================================

  // Swipe offset for lightbox image navigation (touch only)
  const [imageSwipeOffset, setImageSwipeOffset] = useState(0);
  const [imageSwipeSwiping, setImageSwipeSwiping] = useState(false);
  const imageSwipeOffsetRef = useRef(0);

  const touchStateRef = useRef<{
    // Pinch tracking
    initialDistance: number;
    initialScale: number;
    initialMidpoint: { x: number; y: number };
    // Single-finger pan
    panStart: { x: number; y: number } | null;
    isPinching: boolean;
    // Double-tap detection
    lastTapTime: number;
    lastTapPos: { x: number; y: number };
    // Lightbox swipe navigation (scale === 1)
    swipeStartX: number;
    swipeStartY: number;
    swipeDecided: boolean;
    swipeIsHorizontal: boolean;
    swipeActive: boolean;
  }>({
    initialDistance: 0,
    initialScale: 1,
    initialMidpoint: { x: 0, y: 0 },
    panStart: null,
    isPinching: false,
    lastTapTime: 0,
    lastTapPos: { x: 0, y: 0 },
    swipeStartX: 0,
    swipeStartY: 0,
    swipeDecided: false,
    swipeIsHorizontal: false,
    swipeActive: false,
  });

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const getTouchDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    const getTouchMidpoint = (t1: Touch, t2: Touch) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });

    const onTouchStart = (e: TouchEvent) => {
      const ts = touchStateRef.current;

      if (e.touches.length === 2) {
        // Start pinch
        e.preventDefault();
        ts.isPinching = true;
        ts.panStart = null;
        ts.initialDistance = getTouchDistance(e.touches[0], e.touches[1]);
        ts.initialScale = scaleRef.current;
        ts.initialMidpoint = getTouchMidpoint(e.touches[0], e.touches[1]);
      } else if (e.touches.length === 1) {
        const now = Date.now();
        const touch = e.touches[0];
        const dt = now - ts.lastTapTime;
        const dx = Math.abs(touch.clientX - ts.lastTapPos.x);
        const dy = Math.abs(touch.clientY - ts.lastTapPos.y);

        // Detect double-tap (two taps within 300ms, within 30px)
        if (dt < 300 && dx < 30 && dy < 30 && variant === 'lightbox') {
          e.preventDefault();
          ts.lastTapTime = 0; // Reset so triple-tap doesn't trigger

          if (scaleRef.current > 1) {
            // Zoom out to 1x
            applyZoom(1, true);
          } else {
            // Zoom in to 2.5x centered on tap
            const rect = container.getBoundingClientRect();
            const tapX = touch.clientX - rect.left - rect.width / 2;
            const tapY = touch.clientY - rect.top - rect.height / 2;
            const newScale = 2.5;
            setIsAnimating(true);
            setTimeout(() => setIsAnimating(false), ZOOM_TRANSITION_MS);
            setScale(newScale);
            setPosition({
              x: tapX * (1 - newScale),
              y: tapY * (1 - newScale),
            });
          }
          return;
        }

        ts.lastTapTime = now;
        ts.lastTapPos = { x: touch.clientX, y: touch.clientY };

        // Start single-finger pan (only when zoomed)
        if (scaleRef.current > 1) {
          e.preventDefault();
          ts.panStart = {
            x: touch.clientX - positionRef.current.x,
            y: touch.clientY - positionRef.current.y,
          };
        } else if (variant === 'lightbox' && displayImagesRef.current.length > 1) {
          // At scale 1 in lightbox with multiple images: start swipe tracking
          ts.swipeStartX = touch.clientX;
          ts.swipeStartY = touch.clientY;
          ts.swipeDecided = false;
          ts.swipeIsHorizontal = false;
          ts.swipeActive = true;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = touchStateRef.current;

      if (e.touches.length === 2 && ts.isPinching) {
        e.preventDefault();
        const newDist = getTouchDistance(e.touches[0], e.touches[1]);
        const ratio = newDist / ts.initialDistance;
        const newScale = Math.min(Math.max(MIN_SCALE, ts.initialScale * ratio), MAX_SCALE);

        // Zoom centered on pinch midpoint
        const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
        const rect = container.getBoundingClientRect();
        const cx = mid.x - rect.left - rect.width / 2;
        const cy = mid.y - rect.top - rect.height / 2;

        // Position adjustment: keep the midpoint stationary
        const prevScale = scaleRef.current;
        const scaleChange = newScale / prevScale;

        setScale(newScale);
        setPosition((prev) => ({
          x: cx - scaleChange * (cx - prev.x),
          y: cy - scaleChange * (cy - prev.y),
        }));

        if (newScale === 1) {
          setPosition({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1 && ts.panStart && !ts.isPinching) {
        e.preventDefault();
        const touch = e.touches[0];
        setPosition({
          x: touch.clientX - ts.panStart.x,
          y: touch.clientY - ts.panStart.y,
        });
      } else if (e.touches.length === 1 && ts.swipeActive && !ts.isPinching) {
        // Lightbox swipe-to-navigate at scale 1
        const touch = e.touches[0];
        const dx = touch.clientX - ts.swipeStartX;
        const dy = touch.clientY - ts.swipeStartY;

        if (!ts.swipeDecided) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          ts.swipeDecided = true;
          ts.swipeIsHorizontal = Math.abs(dx) > Math.abs(dy);
          if (ts.swipeIsHorizontal) setImageSwipeSwiping(true);
        }

        if (ts.swipeIsHorizontal) {
          e.preventDefault();
          imageSwipeOffsetRef.current = dx;
          setImageSwipeOffset(dx);
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const ts = touchStateRef.current;

      if (e.touches.length === 0) {
        // Resolve lightbox swipe if active
        if (ts.swipeActive && ts.swipeIsHorizontal) {
          const container = imageContainerRef.current;
          const width = container?.clientWidth ?? window.innerWidth;
          const off = imageSwipeOffsetRef.current;
          const committed = Math.abs(off) > width * 0.2;

          if (committed) {
            if (off < 0) nextImageRef.current();
            else prevImageRef.current();
            imageSwipeOffsetRef.current = 0;
            setImageSwipeOffset(0);
            setImageSwipeSwiping(false);
          } else {
            // Snap back
            setImageSwipeSwiping(false);
            requestAnimationFrame(() => {
              imageSwipeOffsetRef.current = 0;
              setImageSwipeOffset(0);
            });
          }

          ts.swipeActive = false;
          ts.swipeDecided = false;
          ts.swipeIsHorizontal = false;
        }

        ts.isPinching = false;
        ts.panStart = null;

        // Snap to 1x if very close
        if (scaleRef.current < 1.05 && scaleRef.current > 0.95) {
          setIsAnimating(true);
          setTimeout(() => setIsAnimating(false), ZOOM_TRANSITION_MS);
          setScale(1);
          setPosition({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1 && ts.isPinching) {
        // Went from 2 fingers to 1 — transition to pan
        ts.isPinching = false;
        const touch = e.touches[0];
        ts.panStart = {
          x: touch.clientX - positionRef.current.x,
          y: touch.clientY - positionRef.current.y,
        };
      }
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [variant, applyZoom]);

  // ============================================================================
  // LIGHTBOX: DOUBLE-CLICK ZOOM + MINIMAP
  // ============================================================================

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (variant !== "lightbox") return;
      if (scaleRef.current > 1) {
        applyZoom(1, true);
      } else {
        const container = imageContainerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const clickX = e.clientX - rect.left - rect.width / 2;
        const clickY = e.clientY - rect.top - rect.height / 2;
        const newScale = 2.5;
        setIsAnimating(true);
        setTimeout(() => setIsAnimating(false), ZOOM_TRANSITION_MS);
        setScale(newScale);
        setPosition({
          x: clickX * (1 - newScale),
          y: clickY * (1 - newScale),
        });
      }
    },
    [variant, applyZoom]
  );

  const minimapPan = useCallback(
    (minimapEl: HTMLDivElement, clientX: number, clientY: number) => {
      const img = imageRef.current;
      if (!img) return;
      const rect = minimapEl.getBoundingClientRect();
      const nx = (clientX - rect.left) / rect.width;
      const ny = (clientY - rect.top) / rect.height;
      const dw = img.clientWidth;
      const dh = img.clientHeight;
      setPosition({
        x: -scaleRef.current * (nx - 0.5) * dw,
        y: -scaleRef.current * (ny - 0.5) * dh,
      });
    },
    []
  );

  const handleMinimapMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const minimapEl = e.currentTarget;

      minimapPan(minimapEl, e.clientX, e.clientY);

      const onMove = (me: MouseEvent) => minimapPan(minimapEl, me.clientX, me.clientY);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [minimapPan]
  );

  const handleMinimapTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const minimapEl = e.currentTarget;
      const touch = e.touches[0];

      minimapPan(minimapEl, touch.clientX, touch.clientY);

      const onMove = (te: TouchEvent) => {
        te.preventDefault();
        minimapPan(minimapEl, te.touches[0].clientX, te.touches[0].clientY);
      };
      const onEnd = () => {
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("touchend", onEnd);
      };
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
    },
    [minimapPan]
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!currentImage) {
    return <div className="letter-viewer-empty">No images available</div>;
  }

  const isLightbox = variant === "lightbox";

  // Panel mode: slider fill percentage
  const sliderPercent = ((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100;

  // Lightbox mode: minimap viewport rect (percentage-based)
  let minimapVp: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null = null;
  if (
    isLightbox &&
    scale > 1 &&
    imageRef.current &&
    imageContainerRef.current
  ) {
    const dw = imageRef.current.clientWidth;
    const dh = imageRef.current.clientHeight;
    const cw = imageContainerRef.current.clientWidth;
    const ch = imageContainerRef.current.clientHeight;
    if (dw > 0 && dh > 0) {
      minimapVp = {
        left:
          Math.max(0, 0.5 - (cw / 2 + position.x) / (scale * dw)) * 100,
        top:
          Math.max(0, 0.5 - (ch / 2 + position.y) / (scale * dh)) * 100,
        width: Math.min(100, (cw / (scale * dw)) * 100),
        height: Math.min(100, (ch / (scale * dh)) * 100),
      };
    }
  }

  return (
    <div
      className={`letter-viewer${isLightbox ? " letter-viewer--lightbox" : ""}`}
    >
      <div
        ref={imageContainerRef}
        className={`viewer-container ${isDragging ? "dragging" : ""}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={isLightbox ? handleDoubleClick : undefined}
      >
        {!viewerReady && (
          <img
            src={thumbSrc}
            alt=""
            className={`viewer-image-thumb ${isAnimating ? "animating" : ""}`}
            style={{
              transform: `translateX(${imageSwipeOffset}px) scale(${scale}) translate(${position.x / scale}px, ${
                position.y / scale
              }px)`,
              transition: imageSwipeOffset !== 0 && !imageSwipeSwiping
                ? 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)'
                : undefined,
            }}
            draggable={false}
            aria-hidden
          />
        )}
        <img
          ref={imageRef}
          src={fullLoaded ? fullSrc : midSrc}
          alt={
            getImageAlt
              ? getImageAlt(currentImage)
              : `${currentImage.type} ${currentImage.pageNumber || ""}`
          }
          className={`viewer-image ${isAnimating ? "animating" : ""}`}
          style={{
            transform: `translateX(${imageSwipeOffset}px) scale(${scale}) translate(${position.x / scale}px, ${
              position.y / scale
            }px)`,
            transition: [
              imageSwipeOffset !== 0 && !imageSwipeSwiping
                ? 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)'
                : undefined,
              !viewerReady ? 'opacity 400ms ease-out' : undefined,
            ].filter(Boolean).join(', ') || undefined,
            cursor:
              scale > 1
                ? isDragging
                  ? "grabbing"
                  : "grab"
                : isLightbox
                  ? "zoom-in"
                  : onImageClick
                    ? "pointer"
                    : "default",
            opacity: viewerReady ? 1 : 0,
          }}
          draggable={false}
        />

        {/* Panel mode: bottom overlay bar */}
        {!isLightbox && (
          <div className="viewer-overlay">
            <div className="overlay-left">
              <div className="zoom-slider-container">
                <div
                  ref={sliderTrackRef}
                  className="zoom-slider-track"
                  onClick={handleSliderClick}
                  onMouseDown={handleSliderMouseDown}
                >
                  <div
                    className={`zoom-slider-fill ${isAnimating ? "animating" : ""}`}
                    style={{ width: `${sliderPercent}%` }}
                  />
                  <div
                    className={`zoom-slider-handle ${isAnimating ? "animating" : ""}`}
                    style={{ left: `${sliderPercent}%` }}
                  />
                </div>
                <span className="zoom-percentage">
                  {Math.round(scale * 100)}%
                </span>
              </div>
            </div>

            <div className="overlay-center">
              {displayImages.length > 1 && (
                <>
                  <button onClick={prevImage} className="nav-button" aria-label="Previous page">
                    <Icon name="arrow-left" size={14} />
                  </button>
                  <span className="image-counter">
                    {currentImageIndex + 1} / {displayImages.length}
                  </span>
                  <button onClick={nextImage} className="nav-button" aria-label="Next page">
                    <Icon name="arrow-right" size={14} />
                  </button>
                </>
              )}
            </div>

            <div className="overlay-right">
              <span className="image-type-label">
                {currentImage.type.replace(/_/g, " ")}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Lightbox mode: floating controls */}
      {isLightbox && (
        <>
          {displayImages.length > 1 && (
            <>
              <button
                type="button"
                className="viewer-nav viewer-nav--prev"
                onClick={prevImage}
                aria-label="Previous page"
              >
                <Icon name="arrow-left" size={20} />
              </button>
              <button
                type="button"
                className="viewer-nav viewer-nav--next"
                onClick={nextImage}
                aria-label="Next page"
              >
                <Icon name="arrow-right" size={20} />
              </button>
              <div className="viewer-page-counter">
                {currentImageIndex + 1} / {displayImages.length}
              </div>
            </>
          )}

          <div className="viewer-zoom-badge">
            {Math.round(scale * 100)}%
          </div>

          {minimapVp && (
            <div
              className="viewer-minimap"
              onMouseDown={handleMinimapMouseDown}
              onTouchStart={handleMinimapTouchStart}
            >
              <img
                src={getImageUrl(currentImage.imageUrl, { width: 200 })}
                alt=""
                className="minimap-thumb"
                draggable={false}
              />
              <div
                className="minimap-viewport"
                style={{
                  left: `${minimapVp.left}%`,
                  top: `${minimapVp.top}%`,
                  width: `${minimapVp.width}%`,
                  height: `${minimapVp.height}%`,
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
});

LetterViewer.displayName = "LetterViewer";

export default LetterViewer;
