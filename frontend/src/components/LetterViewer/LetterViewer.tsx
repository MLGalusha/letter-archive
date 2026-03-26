import { useState, useRef, useEffect, useCallback } from "react";
import type { LetterImage } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
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

export default function LetterViewer({
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

  // Initialize scale and position from localStorage synchronously to prevent flash
  const [scale, setScale] = useState(() => {
    const initial = getInitialStateForLetter(letterId, displayImages, 0);
    return initial.scale;
  });
  const [position, setPosition] = useState(() => {
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
  useEffect(() => {
    if (!letterId) {
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
  }, [currentImageIndex, letterId, displayImages]);

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
    const handleGlobalWheel = (e: WheelEvent) => {
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

    document.addEventListener("wheel", handleGlobalWheel, { passive: false });

    return () => {
      document.removeEventListener("wheel", handleGlobalWheel, { passive: false } as EventListenerOptions);
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

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (scale === 1) return;

    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({
      x: touch.clientX - position.x,
      y: touch.clientY - position.y,
    });
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return;

    const touch = e.touches[0];
    setPosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

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

  const handleMinimapMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const minimapEl = e.currentTarget;

      const pan = (clientX: number, clientY: number) => {
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
      };

      pan(e.clientX, e.clientY);

      const onMove = (me: MouseEvent) => pan(me.clientX, me.clientY);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    []
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={isLightbox ? handleDoubleClick : undefined}
      >
        <img
          ref={imageRef}
          src={getImageUrl(currentImage.imageUrl)}
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
                  <button onClick={prevImage} className="nav-button">
                    <Icon name="arrow-left" size={14} />
                  </button>
                  <span className="image-counter">
                    {currentImageIndex + 1} / {displayImages.length}
                  </span>
                  <button onClick={nextImage} className="nav-button">
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
              >
                <Icon name="arrow-left" size={20} />
              </button>
              <button
                type="button"
                className="viewer-nav viewer-nav--next"
                onClick={nextImage}
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
}
