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
const MAX_SCALE = 5;
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
}

interface LetterViewerProps {
  images: LetterImage[];
  letterId?: string;
  showOnlyLetterPages?: boolean;
  onPageChange?: (index: number, image: LetterImage) => void;
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
}: LetterViewerProps) {
  // Filter images if needed
  const displayImages = showOnlyLetterPages
    ? images.filter((img) => img.type === "letter")
    : images;

  const [currentImageIndex, setCurrentImageIndex] = useState(0);

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
    }, 100);
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

        const delta = e.deltaY * -0.01;
        const currentScale = scaleRef.current;
        const newScale = Math.min(Math.max(MIN_SCALE, currentScale + delta), MAX_SCALE);

        applyZoom(newScale, false);
      }
    };

    document.addEventListener("wheel", handleGlobalWheel, { passive: false });

    return () => {
      document.removeEventListener("wheel", handleGlobalWheel);
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

  const handleMouseUp = () => {
    setIsDragging(false);
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
  // RENDER
  // ============================================================================

  if (!currentImage) {
    return <div className="letter-viewer-empty">No images available</div>;
  }

  // Calculate slider fill percentage (0% at 1x, 100% at 5x)
  const sliderPercent = ((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100;

  return (
    <div className="letter-viewer">
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
      >
        <img
          src={getImageUrl(currentImage.imageUrl)}
          alt={`${currentImage.type} ${currentImage.pageNumber || ""}`}
          className={`viewer-image ${isAnimating ? "animating" : ""}`}
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${
              position.y / scale
            }px)`,
            cursor: scale > 1
              ? isDragging
                ? "grabbing"
                : "grab"
              : "default",
          }}
          draggable={false}
        />

        {/* Single bottom overlay - all controls */}
        <div className="viewer-overlay">
          {/* Left: Zoom slider */}
          <div className="overlay-left">
            {/* Zoom slider */}
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
              <span className="zoom-percentage">{Math.round(scale * 100)}%</span>
            </div>
          </div>

          {/* Center: Navigation */}
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

          {/* Right: Page type */}
          <div className="overlay-right">
            <span className="image-type-label">
              {currentImage.type.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
