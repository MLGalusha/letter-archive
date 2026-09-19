import { imagePreloadService } from "../../services/imagePreloadService";
import { RetryingImage } from "../common/RetryingImage";
import { memo, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useId, type CSSProperties } from "react";
import type { LetterImage } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import { useProgressiveImage } from "../../hooks/useProgressiveImage";
import { useImageRetry } from "../../hooks/useImageRetry";
import { Icon } from "../common";
import "./LetterViewer.css";
import { scanNeedsOriginal, scanVariantWidth } from "./scanResolution";
import { useScanDisplayWidth } from "./useScanDisplayWidth";
import { useViewerSwipe } from "./useViewerSwipe";
import { createPageMotion } from './pageMotion';
import { ViewerPageDrawer } from "./ViewerPageDrawer";
import { InlineScanNavigation } from "./InlineScanNavigation";

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
  focusMode?: boolean;
  cornerRatios?: number[];
  entryZoom?: number;
  initialAspectRatio?: number;
  fallbackSrc?: string;
  onClose?: () => void;
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
  focusMode = false,
  cornerRatios,
  entryZoom = 1,
  initialAspectRatio,
  fallbackSrc,
  onClose,
}: LetterViewerProps) {
  const isLightbox = variant === "lightbox";
  const drawerId = useId();
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomAnimating = useRef(false);
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
  const focusFitRef = useRef<HTMLDivElement>(null);
  const zoomOutIntent = useRef({ amount: 0, time: 0 });
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

  const pageMotion = useMemo(() => createPageMotion(), []);
  const swipeCommitRef = useRef<(direction: -1 | 1) => void>(() => {});
  const commitSwipe = useCallback((direction: -1 | 1) => swipeCommitRef.current(direction), []);
  const swipe = useViewerSwipe(imageContainerRef, commitSwipe,
    `${letterId ?? ''}:${displayImages.map(image => `${image.id}:${image.imageUrl}`).join('|')}`);
  const { readOffset: readSwipeOffset, cancel: cancelSwipe, begin: beginSwipe, move: moveSwipe, release: releaseSwipe, settlingRef: swipeSettlingRef } = swipe;

  // Read the rendered carriage during both finger tracking and CSS settlement.
  // This gives the filmstrip the same progress instead of a second animation.
  useLayoutEffect(() => {
    if (!swipe.offset && !swipe.settling) { pageMotion.publish(null); return; }
    let frame = 0;
    const follow = () => {
      const stage = imageContainerRef.current;
      const carriage = stage?.querySelector('.viewer-carriage');
      if (carriage && stage?.clientWidth) {
        const x = readSwipeOffset();
        pageMotion.publish(currentImageIndex - x / stage.clientWidth);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [swipe.offset, swipe.settling, currentImageIndex, pageMotion, readSwipeOffset]);

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

  const [pinchResolutionScale, setPinchResolutionScale] = useState<number | null>(null);
  const resolutionScale = pinchResolutionScale ?? scale;
  const currentImage = displayImages[currentImageIndex];
  const [loadedAspect, setLoadedAspect] = useState<{ url: string; ratio: number } | null>(null);

  // Choose detail from the fitted display size rather than the original file size.
  // Opening the lightbox is not itself a request for the original scan.
  const aspectRatio = currentImage?.width && currentImage?.height
    ? currentImage.width / currentImage.height
    : loadedAspect?.url === currentImage?.imageUrl ? loadedAspect.ratio
      : currentImageIndex === initialIndex && initialAspectRatio ? initialAspectRatio : 3 / 4;
  const physicalWidth = useScanDisplayWidth(focusMode ? focusFitRef : imageContainerRef, aspectRatio, true);
  const thumbSrc = getImageUrl(currentImage?.imageUrl ?? "", { width: 32 });
  const fullSrc = scanNeedsOriginal(physicalWidth, resolutionScale)
    ? getImageUrl(currentImage?.imageUrl ?? "")
    : getImageUrl(currentImage?.imageUrl ?? "", { width: scanVariantWidth(physicalWidth * resolutionScale) });
  const midSrc = imagePreloadService.availablePreview(currentImage?.imageUrl ?? "", scanNeedsOriginal(physicalWidth, resolutionScale) ? Infinity : scanVariantWidth(physicalWidth * resolutionScale));
  const { fullLoaded, midLoaded, fullFailed, fullAdmitted, onFullLoad, onFullError } = useProgressiveImage({
    enabled: Boolean(currentImage) && physicalWidth > 0,
    thumbSrc,
    midSrc,
    fullSrc,
    fullLoadMode: 'dom',
    context: variant === "lightbox" ? 'viewer-lightbox' : 'viewer-panel',
  });
  const displayedRetry = useImageRetry(fullSrc);
  const placeholderSrc = midLoaded && midSrc ? midSrc
    : focusMode && currentImageIndex === initialIndex && fallbackSrc ? fallbackSrc : thumbSrc;
  const placeholderRetry = useImageRetry(placeholderSrc);
  const activeScanReady = fullLoaded && !displayedRetry.failed;
  const handleFullLoad = (image: HTMLImageElement) => {
    displayedRetry.onLoad();
    onFullLoad(image);
    if (image.naturalWidth && image.naturalHeight) {
      const ratio = image.naturalWidth / image.naturalHeight;
      setLoadedAspect(previous => previous?.url === currentImage.imageUrl && previous.ratio === ratio
        ? previous : { url: currentImage.imageUrl, ratio });
    }
  };
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (fullAdmitted && !fullLoaded && !displayedRetry.failed && image?.complete && image.naturalWidth > 0) handleFullLoad(image);
  });
  useLayoutEffect(() => {
    const image = imageRef.current;
    return () => { if (image && !image.complete) image.removeAttribute('src'); };
  }, [fullSrc, displayedRetry.attempt]);

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
    if (isLightbox || !letterIdRef.current) return;

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
  }, [isLightbox]);

  // Save state when scale or position changes (debounced via effect)
  useEffect(() => {
    if (isLightbox) return;
    const timeoutId = setTimeout(() => {
      saveCurrentImageState();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [scale, position, saveCurrentImageState, isLightbox]);

  // Handle letter change - clear storage if different letter
  useEffect(() => {
    if (isLightbox) return;
    const stored = loadStoredState();
    if (stored && letterId && stored.letterId !== letterId) {
      // Different letter - clear old state and start fresh
      saveStoredState({ letterId, images: {} });
    } else if (letterId && !stored) {
      // No stored state - initialize for this letter
      saveStoredState({ letterId, images: {} });
    }
  }, [letterId, isLightbox]);

  // Load state when changing images within the same letter
  // Lightbox always resets to 1x; panel restores from localStorage
  useEffect(() => {
    // Focus thumbnails exit to the document; preserve zoom for the return flight.
    if (focusMode) return;
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
  }, [currentImageIndex, letterId, displayImages, variant, focusMode]);

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

  useLayoutEffect(() => {
    if (!isLightbox) return;
    // Container observation can precede the fitted surface's new dimensions.
    // Recheck after that render, including an intrinsic aspect-ratio discovery.
    setPosition(previous => {
      const next = clampPosition(previous, scaleRef.current);
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
  }, [isLightbox, physicalWidth, aspectRatio, clampPosition]);

  const animateZoom = useCallback(() => {
    if (zoomTimer.current !== null) clearTimeout(zoomTimer.current);
    const animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    zoomAnimating.current = animate;
    setIsAnimating(animate);
    if (animate) zoomTimer.current = setTimeout(() => { zoomTimer.current = null; zoomAnimating.current = false; setIsAnimating(false); }, ZOOM_TRANSITION_MS);
  }, []);
  useEffect(() => () => { if (zoomTimer.current !== null) clearTimeout(zoomTimer.current); }, []);

  const interruptZoom = useCallback(() => {
    if (!zoomAnimating.current) return;
    if (zoomTimer.current !== null) clearTimeout(zoomTimer.current);
    zoomTimer.current = null;
    zoomAnimating.current = false;
    const surface = imageContainerRef.current?.querySelector('.viewer-transform');
    // Direct manipulation starts from the visible in-flight zoom, not its target.
    if (isLightbox && surface && typeof DOMMatrixReadOnly !== 'undefined') {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
      scaleRef.current = Math.max(MIN_SCALE, matrix.a);
      positionRef.current = { x: matrix.m41, y: matrix.m42 };
      setScale(scaleRef.current);
      setPosition(positionRef.current);
    }
    setIsAnimating(false);
  }, [isLightbox]);

  // Apply zoom while maintaining view center
  const applyZoom = useCallback((newScale: number, animate: boolean) => {
    cancelSwipe();
    if (focusMode && newScale < 1) {
      const now = performance.now();
      if (now - zoomOutIntent.current.time > 250) zoomOutIntent.current.amount = 0;
      zoomOutIntent.current.time = now;
      zoomOutIntent.current.amount += Math.log(1 / Math.max(.01, newScale));
      if (zoomOutIntent.current.amount > .18) { onClose?.(); return; }
    } else zoomOutIntent.current.amount = 0;
    const clampedScale = Math.min(Math.max(MIN_SCALE, newScale), MAX_SCALE);

    if (animate) animateZoom();
    else interruptZoom();

    // Adjust position to maintain view center
    const oldScale = scaleRef.current;
    if (oldScale !== clampedScale) {
      const ratio = clampedScale / oldScale;
      setPosition((prev) => clampPosition({
        x: prev.x * ratio,
        y: prev.y * ratio,
      }, clampedScale));
    }

    scaleRef.current = clampedScale;
    setScale(clampedScale);

    // Reset position if back to 1x
    if (clampedScale === 1) {
      setPosition({ x: 0, y: 0 });
    }
  }, [clampPosition, cancelSwipe, animateZoom, interruptZoom, focusMode, onClose]);

  useEffect(() => {
    if (!focusMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (!imageContainerRef.current?.closest('[role="dialog"]')?.contains(event.target as Node)) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); applyZoom(scaleRef.current * 1.4, true); }
      if (event.key === '-') { event.preventDefault(); applyZoom(scaleRef.current / 1.4, true); }
      if (event.key === '0') { event.preventDefault(); applyZoom(1, true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [focusMode, applyZoom]);

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

  // A pinch can begin on the document scan and continue on that original native
  // touch target. Consume its live scale without restarting the gesture.
  const entryZoomHandler = useRef(applyZoom);
  useLayoutEffect(() => { entryZoomHandler.current = applyZoom; }, [applyZoom]);
  useEffect(() => {
    if (focusMode) entryZoomHandler.current(entryZoom, false);
  }, [entryZoom, focusMode]);

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

        interruptZoom();
        // Multiplicative zoom: speed increases proportionally with current scale
        const factor = Math.pow(1.01, -e.deltaY);
        const currentScale = scaleRef.current;
        const newScale = currentScale * factor;

        applyZoom(newScale, false);
      } else if (focusMode) {
        e.preventDefault();
        const next = clampPosition({ x: positionRef.current.x - e.deltaX, y: positionRef.current.y - e.deltaY }, scaleRef.current);
        positionRef.current = next;
        setPosition(next);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [applyZoom, interruptZoom, focusMode, clampPosition]);

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  const selectImage = useCallback((index: number) => {
    cancelSwipe();
    saveCurrentImageState();
    if (!focusMode) {
      scaleRef.current = 1;
      positionRef.current = { x: 0, y: 0 };
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
    if (zoomTimer.current !== null) clearTimeout(zoomTimer.current);
    zoomTimer.current = null;
    zoomAnimating.current = false;
    setIsAnimating(false);
    if (gestureFrame.current !== null) cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = null;
    setPinchResolutionScale(null);
    touchStateRef.current.swipeActive = false;
    touchStateRef.current.panStart = null;
    touchStateRef.current.isPinching = false;
    touchStateRef.current.lastTapTime = 0;
    if (focusMode) {
      // Queue the destination without replacing the scan being zoomed out.
      onPageChange?.(index, displayImages[index]);
      onClose?.();
      return false; // The regular page owns thumbnail movement after the return.
    }
    currentImageIndexRef.current = index;
    setCurrentImageIndex(index);
  }, [saveCurrentImageState, cancelSwipe, focusMode, onPageChange, onClose, displayImages]);
  const nextImage = useCallback(() => selectImage((currentImageIndexRef.current + 1) % displayImages.length), [selectImage, displayImages.length]);
  const prevImage = useCallback(() => selectImage((currentImageIndexRef.current - 1 + displayImages.length) % displayImages.length), [selectImage, displayImages.length]);

  useEffect(() => {
    if (variant !== "lightbox" || focusMode || displayImages.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const dialog = imageContainerRef.current?.closest('[aria-modal="true"]');
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (!dialog || dialogs[dialogs.length - 1] !== dialog || !dialog.contains(event.target as Node)) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable
        || event.target.closest('input, textarea, select, [role="slider"], .viewer-page-drawer'))) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      // Match the page buttons: wrap pages and reset zoom/pan to fit.
      if (event.key === "ArrowRight") nextImage();
      else prevImage();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant, focusMode, displayImages.length, nextImage, prevImage]);

  useEffect(() => {
    swipeCommitRef.current = (direction) => direction > 0 ? nextImage() : prevImage();
  }, [nextImage, prevImage]);

  // ============================================================================
  // IMAGE DRAG/PAN HANDLERS
  // ============================================================================

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    interruptZoom();
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    mouseDownOnImage.current = (e.target as HTMLElement).tagName === 'IMG';
    if (scaleRef.current === 1) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y,
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

  const gestureFrame = useRef<number | null>(null);
  const flushGesture = useCallback(() => {
    if (gestureFrame.current !== null) cancelAnimationFrame(gestureFrame.current);
    gestureFrame.current = null;
    setScale(scaleRef.current);
    setPosition(positionRef.current);
  }, []);
  const paintGesture = useCallback(() => {
    if (gestureFrame.current === null) gestureFrame.current = requestAnimationFrame(flushGesture);
  }, [flushGesture]);
  useEffect(() => () => { if (gestureFrame.current !== null) cancelAnimationFrame(gestureFrame.current); }, []);

  const touchStateRef = useRef<{
    // Pinch tracking
    initialDistance: number;
    initialScale: number;
    exitOnRelease: boolean;
    previousMidpoint: { x: number; y: number };
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
    exitOnRelease: false,
    previousMidpoint: { x: 0, y: 0 },
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
      interruptZoom();
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
        ts.initialDistance = Math.max(1, getTouchDistance(e.touches[0], e.touches[1]));
        ts.initialScale = scaleRef.current;
        ts.exitOnRelease = false;
        setPinchResolutionScale(scaleRef.current);
        ts.previousMidpoint = getTouchMidpoint(e.touches[0], e.touches[1]);
      } else if (e.touches.length === 1) {
        ts.panStart = null;
        ts.isPinching = false;
        ts.swipeActive = false;
        if (swipeSettlingRef.current) ts.lastTapTime = 0;
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
            animateZoom();
            scaleRef.current = newScale;
            setScale(newScale);
            setPosition(clampPosition({
              x: tapX * (1 - newScale),
              y: tapY * (1 - newScale),
            }, newScale));
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
        } else if (variant === 'lightbox' && !focusMode && displayImagesRef.current.length > 1) {
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
        const rawScale = ts.initialScale * ratio;
        ts.exitOnRelease = focusMode && rawScale < .88;
        const newScale = Math.min(Math.max(MIN_SCALE, rawScale), MAX_SCALE);

        // Zoom centered on pinch midpoint
        const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
        const rect = container.getBoundingClientRect();
        const cx = mid.x - rect.left - rect.width / 2;
        const cy = mid.y - rect.top - rect.height / 2;

        const previousX = ts.previousMidpoint.x - rect.left - rect.width / 2;
        const previousY = ts.previousMidpoint.y - rect.top - rect.height / 2;
        ts.previousMidpoint = mid;

        // Keep the point between both fingers attached while they move and scale.
        const prevScale = scaleRef.current;
        const scaleChange = newScale / prevScale;

        scaleRef.current = newScale;
        const prev = positionRef.current;
        positionRef.current = newScale === 1 ? { x: 0, y: 0 } : clampPosition({
          x: cx - scaleChange * (previousX - prev.x),
          y: cy - scaleChange * (previousY - prev.y),
        }, newScale);
        paintGesture();
      } else if (e.touches.length === 1 && ts.panStart && !ts.isPinching) {
        e.preventDefault();
        const touch = e.touches[0];
        positionRef.current = clampPosition({
          x: touch.clientX - ts.panStart.x,
          y: touch.clientY - ts.panStart.y,
        }, scaleRef.current);
        paintGesture();
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
      if (ts.isPinching || ts.panStart) flushGesture();
      if (e.touches.length < 2) setPinchResolutionScale(null);

      if (e.touches.length === 0) {
        if (ts.exitOnRelease) { ts.exitOnRelease = false; onClose?.(); }
        if (ts.swipeActive) releaseSwipe();
        ts.swipeActive = false;

        ts.isPinching = false;
        ts.panStart = null;

        // Snap to 1x if very close
        if (scaleRef.current < 1.05 && scaleRef.current > 0.95) {
          animateZoom();
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
      flushGesture();
      setPinchResolutionScale(null);
      cancelSwipe();
      const ts = touchStateRef.current;
      ts.swipeActive = false;
      ts.exitOnRelease = false;
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
  }, [variant, focusMode, onClose, applyZoom, clampPosition, beginSwipe, moveSwipe, releaseSwipe, cancelSwipe, swipeSettlingRef, animateZoom, interruptZoom, flushGesture, paintGesture]);

  useEffect(() => {
    const element = imageContainerRef.current;
    if (!isLightbox || !element) return;
    let width = element.clientWidth;
    let height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (width === element.clientWidth && height === element.clientHeight) return;
      width = element.clientWidth;
      height = element.clientHeight;
      cancelSwipe();
      flushGesture();
      setPinchResolutionScale(null);
      touchStateRef.current.panStart = null;
      touchStateRef.current.swipeActive = false;
      touchStateRef.current.isPinching = false;
      setPosition(previous => clampPosition(previous, scaleRef.current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isLightbox, cancelSwipe, clampPosition, flushGesture]);

  // ============================================================================
  // LIGHTBOX: DOUBLE-CLICK ZOOM
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
        animateZoom();
        scaleRef.current = newScale;
        setScale(newScale);
        setPosition(clampPosition({
          x: clickX * (1 - newScale),
          y: clickY * (1 - newScale),
        }, newScale));
      }
    },
    [variant, applyZoom, cancelSwipe, animateZoom, clampPosition]
  );

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!currentImage) {
    return <div className="letter-viewer-empty">No images available</div>;
  }

  // Panel mode: slider fill percentage
  const sliderPercent = ((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100;


  return (
    <div
      style={focusMode ? { '--scan-image-corner-radius': `${physicalWidth / (window.devicePixelRatio || 1) * (cornerRatios?.[currentImageIndex] ?? .01)}px` } as CSSProperties : undefined}
      data-zoom={scale}
      className={`letter-viewer${focusMode ? " letter-viewer--focus" : ""}${focusMode && scale > 1.01 ? " letter-viewer--zoomed" : ""}${isLightbox ? " letter-viewer--lightbox" : ""}${isLightbox && onClose && !focusMode ? " letter-viewer--with-header" : ""}`}
    >
      {isLightbox && onClose && !focusMode && <div className="viewer-modal-header">
        <span className="viewer-mobile-zoom" aria-label="Zoom level">{Math.round(scale * 100)}%</span>
        <button type="button" className="viewer-close" tabIndex={0} onClick={onClose} aria-label="Close viewer"><Icon name="close" size={24} /></button>
      </div>}
      {focusMode && <div ref={focusFitRef} className="reader-focus-fit" aria-hidden="true" />}
      <div className="viewer-workspace">
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
            transition: swipe.settling ? `transform ${swipe.duration}ms ${swipe.easing}` : 'none' }}
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
        <div className={`viewer-transform${isAnimating ? ' animating' : ''}`} style={isLightbox ? {
          cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          width: physicalWidth / (window.devicePixelRatio || 1),
          height: physicalWidth / (window.devicePixelRatio || 1) / aspectRatio,
          transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
        } : undefined}>
        {!fullLoaded && physicalWidth > 0 && (
          <img
            key={`placeholder:${placeholderSrc}:${placeholderRetry.attempt}`}
            src={placeholderSrc}
            onLoad={placeholderRetry.onLoad}
            onError={placeholderRetry.onError}
            alt=""
            className={`viewer-image-thumb ${isAnimating ? "animating" : ""}`}
            style={{
              filter: midLoaded || (focusMode && fallbackSrc && currentImageIndex === initialIndex) ? 'none' : undefined,
              visibility: placeholderRetry.failed ? 'hidden' : undefined,
              transform: isLightbox ? undefined : `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            }}
            draggable={false}
            aria-hidden
          />
        )}
        <img
          key={`main:${fullSrc}:${displayedRetry.attempt}`}
          ref={imageRef}
          onError={() => { onFullError(); displayedRetry.onError(); }}
          onLoad={(event) => handleFullLoad(event.currentTarget)}
          src={physicalWidth > 0 && fullAdmitted ? fullSrc : undefined}
          alt={
            getImageAlt
              ? getImageAlt(currentImage)
              : `${currentImage.type} ${currentImage.pageNumber || ""}`
          }
          className={`viewer-image ${isAnimating ? "animating" : ""}`}
          style={{
            transform: isLightbox ? undefined : `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: !isLightbox && !fullLoaded ? 'opacity 400ms ease-out' : undefined,
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
            opacity: fullLoaded ? 1 : 0,
            visibility: displayedRetry.failed ? "hidden" : undefined,
          }}
          draggable={false}
        />

        </div>
        {((displayedRetry.failed || fullFailed) && (!midLoaded || placeholderRetry.failed)) && (
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

      {focusMode && <div className="reader-focus-strip" style={{ maxWidth: (displayImages.length - 1) * 128 + 64 }}><InlineScanNavigation cornerRatios={cornerRatios} images={displayImages}
        selected={currentImageIndex} onSelect={selectImage} /></div>}
      {isLightbox && !focusMode && <ViewerPageDrawer id={drawerId} images={displayImages}
        selected={currentImageIndex} onSelect={selectImage} motion={pageMotion} />}
      </div>
      {isLightbox && <span className="viewer-page-counter sr-only" role="status" aria-live="polite" aria-atomic="true" aria-label="Scan page">{currentImageIndex + 1} / {displayImages.length}</span>}
      {isLightbox && !focusMode && <div className="viewer-toolbar" aria-label="Scan controls">
        <div className="viewer-zoom-controls">
          <button type="button" tabIndex={0} onClick={() => applyZoom(scaleRef.current / 1.4, true)} disabled={scale <= MIN_SCALE} aria-label="Zoom out">−</button>
          <span className="viewer-zoom-badge" aria-label="Zoom level">{Math.round(scale * 100)}%</span>
          <button type="button" tabIndex={0} onClick={() => applyZoom(scaleRef.current * 1.4, true)} disabled={scale >= MAX_SCALE} aria-label="Zoom in">+</button>
          <button type="button" tabIndex={0} onClick={() => applyZoom(1, true)} aria-label="Fit scan">Fit</button>
        </div>
      </div>}

    </div>
  );
});

LetterViewer.displayName = "LetterViewer";

export default LetterViewer;
