import { imagePreloadService } from "../../services/imagePreloadService";
import { RetryingImage } from "../common/RetryingImage";
import { memo, useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { LetterImage } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { useProgressiveImage } from "../../hooks/useProgressiveImage";
import { useImageRetry } from "../../hooks/useImageRetry";
import { Icon } from "../common";
import "./LetterViewer.css";
import { scanNeedsOriginal, scanVariantWidth } from "./scanResolution";
import { useScanDisplayWidth } from "./useScanDisplayWidth";
import { useViewerSwipe, VIEWER_SWIPE_MS } from "./useViewerSwipe";

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
  const displayImages = useMemo(() => showOnlyLetterPages
    ? images.filter((img) => img.type === "letter")
    : images, [showOnlyLetterPages, images]);

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

  const swipeCommitRef = useRef<(direction: -1 | 1) => void>(() => {});
  const commitSwipe = useCallback((direction: -1 | 1) => swipeCommitRef.current(direction), []);
  const swipe = useViewerSwipe(imageContainerRef, commitSwipe,
    `${letterId ?? ''}:${displayImages.map(image => `${image.id}:${image.imageUrl}`).join('|')}`);
  const { cancel: cancelSwipe, begin: beginSwipe, move: moveSwipe, release: releaseSwipe, settlingRef: swipeSettlingRef } = swipe;

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
  const [loadedAspect, setLoadedAspect] = useState<{ url: string; ratio: number } | null>(null);

  // Choose detail from the fitted display size rather than the original file size.
  // Opening the lightbox is not itself a request for the original scan.
  const aspectRatio = currentImage?.width && currentImage?.height
    ? currentImage.width / currentImage.height
    : loadedAspect?.url === currentImage?.imageUrl ? loadedAspect.ratio : 3 / 4;
  const physicalWidth = useScanDisplayWidth(imageContainerRef, aspectRatio, true);
  const thumbSrc = getImageUrl(currentImage?.imageUrl ?? "", { width: 32 });
  const fullSrc = scanNeedsOriginal(physicalWidth, scale)
    ? getImageUrl(currentImage?.imageUrl ?? "")
    : getImageUrl(currentImage?.imageUrl ?? "", { width: scanVariantWidth(physicalWidth * scale) });
  const midSrc = imagePreloadService.availablePreview(currentImage?.imageUrl ?? "", scanNeedsOriginal(physicalWidth, scale) ? Infinity : scanVariantWidth(physicalWidth * scale));
  const { fullLoaded, midLoaded, fullFailed } = useProgressiveImage({
    enabled: Boolean(currentImage) && physicalWidth > 0,
    thumbSrc,
    midSrc,
    fullSrc,
    idleUpgrade: variant === "panel",
    context: variant === "lightbox" ? 'viewer-lightbox' : 'viewer-panel',
  });
  const viewerReady = fullLoaded || midLoaded;
  const displayedSrc = fullLoaded ? fullSrc : midLoaded ? midSrc : undefined;
  const displayedRetry = useImageRetry(displayedSrc ?? fullSrc);
  const [displayState, setDisplayState] = useState({ src: displayedSrc, loaded: false });
  if (displayState.src !== displayedSrc) setDisplayState({ src: displayedSrc, loaded: false });
  const activeScanReady = fullLoaded && displayState.src === fullSrc && displayState.loaded && !displayedRetry.failed;

  // Match each neighbor's fitted rendition; no guesses before layout is measured.
  const adjacentWidth = useCallback((image: LetterImage) => {
    const element = imageContainerRef.current;
    const ratio = image.width && image.height ? image.width / image.height : 3 / 4;
    const fitted = element ? Math.min(element.clientWidth, element.clientHeight * ratio) : 0;
    return scanVariantWidth(element ? fitted * (window.devicePixelRatio || 1) : physicalWidth);
  }, [physicalWidth]);
  useEffect(() => {
    if (!activeScanReady || physicalWidth <= 0 || displayImages.length <= 1) return;
    const neighbors = [-1, 1].map(direction => displayImages[
      (currentImageIndex + direction + displayImages.length) % displayImages.length
    ]);
    return imagePreloadService.preloadNeighbors(neighbors.map(image =>
      getImageUrl(image.imageUrl, { width: adjacentWidth(image) })));
  }, [activeScanReady, physicalWidth, currentImageIndex, displayImages, adjacentWidth]);

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

  // Clamp pan so the zoomed image never exposes empty space beyond its edges
  const clampPosition = useCallback((pos: { x: number; y: number }, zoom: number) => {
    const img = imageRef.current;
    const container = imageContainerRef.current;
    if (!img || !container) return pos;
    const iw = img.clientWidth;
    const ih = img.clientHeight;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (iw === 0 || ih === 0) return pos;
    const maxX = Math.max(0, (zoom * iw - cw) / 2);
    const maxY = Math.max(0, (zoom * ih - ch) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, pos.x)),
      y: Math.max(-maxY, Math.min(maxY, pos.y)),
    };
  }, []);

  // Apply zoom while maintaining view center
  const applyZoom = useCallback((newScale: number, animate: boolean) => {
    cancelSwipe();
    const clampedScale = Math.min(Math.max(MIN_SCALE, newScale), MAX_SCALE);

    if (animate) {
      setIsAnimating(true);
      setTimeout(() => setIsAnimating(false), ZOOM_TRANSITION_MS);
    }

    // Adjust position to maintain view center
    const oldScale = scaleRef.current;
    if (oldScale !== clampedScale) {
      const ratio = clampedScale / oldScale;
      setPosition((prev) => clampPosition({
        x: prev.x * ratio,
        y: prev.y * ratio,
      }, clampedScale));
    }

    setScale(clampedScale);

    // Reset position if back to 1x
    if (clampedScale === 1) {
      setPosition({ x: 0, y: 0 });
    }
  }, [clampPosition, cancelSwipe]);

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
    cancelSwipe();
    // Save current state before switching
    saveCurrentImageState();
    // Reset before rendering the next page so the previous zoom cannot fetch its original.
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setCurrentImageIndex((prev) => (prev + 1) % displayImages.length);
  }, [displayImages.length, saveCurrentImageState, cancelSwipe]);

  const prevImage = useCallback(() => {
    cancelSwipe();
    // Save current state before switching
    saveCurrentImageState();
    // Reset before rendering the next page so the previous zoom cannot fetch its original.
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setCurrentImageIndex(
      (prev) => (prev - 1 + displayImages.length) % displayImages.length
    );
  }, [displayImages.length, saveCurrentImageState, cancelSwipe]);

  useEffect(() => {
    swipeCommitRef.current = (direction) => direction > 0 ? nextImage() : prevImage();
  }, [nextImage, prevImage]);

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

    setPosition(clampPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }, scaleRef.current));
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
    swipeActive: boolean;
  }>({
    initialDistance: 0,
    initialScale: 1,
    initialMidpoint: { x: 0, y: 0 },
    panStart: null,
    isPinching: false,
    lastTapTime: 0,
    lastTapPos: { x: 0, y: 0 },
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

      if (e.touches.length >= 2) {
        // Pinch owns the gesture; a partial swipe cannot commit afterward.
        cancelSwipe();
        ts.swipeActive = false;
        ts.lastTapTime = 0;
        // Start pinch
        e.preventDefault();
        ts.isPinching = true;
        ts.panStart = null;
        ts.initialDistance = getTouchDistance(e.touches[0], e.touches[1]);
        ts.initialScale = scaleRef.current;
        ts.initialMidpoint = getTouchMidpoint(e.touches[0], e.touches[1]);
      } else if (e.touches.length === 1) {
        if (swipeSettlingRef.current) { e.preventDefault(); return; }
        const now = Date.now();
        const touch = e.touches[0];
        const dt = now - ts.lastTapTime;
        const dx = Math.abs(touch.clientX - ts.lastTapPos.x);
        const dy = Math.abs(touch.clientY - ts.lastTapPos.y);

        // Detect double-tap (two taps within 300ms, within 30px)
        if (dt < 300 && dx < 30 && dy < 30 && variant === 'lightbox') {
          e.preventDefault();
          ts.lastTapTime = 0; // Reset so triple-tap doesn't trigger
          cancelSwipe();
          ts.swipeActive = false;

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
          ts.swipeActive = beginSwipe(touch.clientX, touch.clientY);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const ts = touchStateRef.current;

      if (e.touches.length === 1 && Math.hypot(
        e.touches[0].clientX - ts.lastTapPos.x,
        e.touches[0].clientY - ts.lastTapPos.y,
      ) > 10) ts.lastTapTime = 0;

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
        setPosition((prev) => clampPosition({
          x: cx - scaleChange * (cx - prev.x),
          y: cy - scaleChange * (cy - prev.y),
        }, newScale));

        if (newScale === 1) {
          setPosition({ x: 0, y: 0 });
        }
      } else if (e.touches.length === 1 && ts.panStart && !ts.isPinching) {
        e.preventDefault();
        const touch = e.touches[0];
        setPosition(clampPosition({
          x: touch.clientX - ts.panStart.x,
          y: touch.clientY - ts.panStart.y,
        }, scaleRef.current));
      } else if (e.touches.length === 1 && ts.swipeActive && !ts.isPinching) {
        // The gesture stays a swipe only while the image remains fitted.
        if (scaleRef.current !== 1) { cancelSwipe(); ts.swipeActive = false; return; }
        const touch = e.touches[0];
        if (moveSwipe(touch.clientX, touch.clientY)) {
          e.preventDefault();
          ts.lastTapTime = 0; // A drag cannot be the first tap of a double-tap.
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const ts = touchStateRef.current;

      if (e.touches.length === 0) {
        if (ts.swipeActive) releaseSwipe();
        ts.swipeActive = false;

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

    const onTouchCancel = () => {
      cancelSwipe();
      const ts = touchStateRef.current;
      ts.swipeActive = false;
      ts.isPinching = false;
      ts.panStart = null;
      ts.lastTapTime = 0;
    };

    container.addEventListener('touchcancel', onTouchCancel, { passive: true });
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchcancel', onTouchCancel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [variant, applyZoom, clampPosition, beginSwipe, moveSwipe, releaseSwipe, cancelSwipe, swipeSettlingRef]);

  // ============================================================================
  // LIGHTBOX: DOUBLE-CLICK ZOOM + MINIMAP
  // ============================================================================

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (variant !== "lightbox") return;
      cancelSwipe();
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
    [variant, applyZoom, cancelSwipe]
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
        <div className="viewer-carriage"
          style={{ transform: `translate3d(${swipe.offset}px, 0, 0)`,
            transition: swipe.settling ? `transform ${VIEWER_SWIPE_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)` : 'none' }}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === 'transform') swipe.finish();
          }}
        >
        {isLightbox && scale === 1 && (swipe.offset !== 0 || swipe.settling) && displayImages.length > 1 && ([-1, 1] as const).map(direction => {
          const adjacent = displayImages[(currentImageIndex + direction + displayImages.length) % displayImages.length];
          return <div key={direction} className="viewer-swipe-neighbor" style={{ left: `${direction * 100}%` }} aria-hidden>
            <RetryingImage src={getImageUrl(adjacent.imageUrl, { width: adjacentWidth(adjacent) })} alt="" draggable={false} />
          </div>;
        })}
        {!viewerReady && physicalWidth > 0 && (
          <RetryingImage
            src={thumbSrc}
            alt=""
            className={`viewer-image-thumb ${isAnimating ? "animating" : ""}`}
            style={{
              transform: `scale(${scale}) translate(${position.x / scale}px, ${
                position.y / scale
              }px)`,
            }}
            draggable={false}
            aria-hidden
          />
        )}
        <img
          key={`${displayedSrc}:${fullLoaded}:${midLoaded}:${displayedRetry.attempt}`}
          ref={imageRef}
          onError={() => {
            setDisplayState({ src: displayedSrc, loaded: false });
            if (viewerReady) displayedRetry.onError();
          }}
          onLoad={(event) => {
            displayedRetry.onLoad();
            setDisplayState({ src: displayedSrc, loaded: true });
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              const ratio = image.naturalWidth / image.naturalHeight;
              setLoadedAspect((previous) => previous?.url === currentImage.imageUrl && previous.ratio === ratio
                ? previous : { url: currentImage.imageUrl, ratio });
            }
          }}
          src={displayedSrc}
          alt={
            getImageAlt
              ? getImageAlt(currentImage)
              : `${currentImage.type} ${currentImage.pageNumber || ""}`
          }
          className={`viewer-image ${isAnimating ? "animating" : ""}`}
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${
              position.y / scale
            }px)`,
            transition: [
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
            visibility: displayedRetry.failed ? "hidden" : undefined,
          }}
          draggable={false}
        />

        {(displayedRetry.failed || (fullFailed && !midLoaded)) && (
          <span className="viewer-image-error" role="status">Image unavailable</span>
        )}
        </div>

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
              <RetryingImage
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
