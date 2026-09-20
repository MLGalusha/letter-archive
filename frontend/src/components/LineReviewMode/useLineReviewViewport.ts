import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent, SyntheticEvent } from 'react';

interface Size { width: number; height: number }
interface Point { x: number; y: number }
const EMPTY_SIZE: Size = { width: 0, height: 0 };
const INITIAL_VIEW = { zoom: 1, pan: { x: 0, y: 0 } };

function clampPan(pan: Point, zoom: number, image: Size, container: Size): Point {
  if (!image.width || !image.height) return pan;
  const maxX = Math.max(0, (zoom * image.width - container.width) / 2);
  const maxY = Math.max(0, (zoom * image.height - container.height) / 2);
  return { x: Math.max(-maxX, Math.min(maxX, pan.x)), y: Math.max(-maxY, Math.min(maxY, pan.y)) };
}

/** Image geometry and gesture lifecycle only; knows nothing about editor content or saves. */
export function useLineReviewViewport({ pageIdentity, initiallyFit, panEnabled }: {
  pageIdentity: string;
  initiallyFit: boolean;
  panEnabled: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageNaturalSize, setImageNaturalSize] = useState(EMPTY_SIZE);
  const [imageDisplaySize, setImageDisplaySize] = useState(EMPTY_SIZE);
  const [containerSize, setContainerSize] = useState(EMPTY_SIZE);
  const [fitHeight, setFitHeight] = useState(initiallyFit);
  const [{ zoom: fitZoom, pan: fitPan }, setView] = useState(INITIAL_VIEW);
  const [isPanning, setIsPanning] = useState(false);
  const [measuredPage, setMeasuredPage] = useState(pageIdentity);
  if (measuredPage !== pageIdentity) {
    setMeasuredPage(pageIdentity);
    setImageNaturalSize(EMPTY_SIZE);
    setImageDisplaySize(EMPTY_SIZE);
    setView(INITIAL_VIEW);
    setIsPanning(false);
  }
  const panStart = useRef<Point | null>(null);
  const minimapDrag = useRef<{ pointerId: number; rect: DOMRect; element: HTMLDivElement } | null>(null);
  const currentIdentity = useRef<string | null>(null);

  const releaseGestures = useCallback(() => {
    panStart.current = null;
    const drag = minimapDrag.current;
    minimapDrag.current = null;
    if (drag?.element.hasPointerCapture?.(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
  }, []);
  const endGestures = useCallback(() => {
    releaseGestures();
    setIsPanning(false);
  }, [releaseGestures]);

  useLayoutEffect(() => {
    currentIdentity.current = pageIdentity;
    return () => {
      currentIdentity.current = null;
      releaseGestures();
    };
  }, [pageIdentity, releaseGestures]);

  const handleImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    if (currentIdentity.current !== pageIdentity || event.currentTarget !== imageRef.current) return;
    const image = event.currentTarget;
    setImageNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    setImageDisplaySize({ width: image.clientWidth, height: image.clientHeight });
  }, [pageIdentity]);

  useLayoutEffect(() => {
    const image = imageRef.current;
    const container = containerRef.current;
    if (!image || !container) return;
    let active = true;
    setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    const observer = new ResizeObserver(entries => {
      if (!active) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (entry.target === container) setContainerSize({ width, height });
        else if (width > 0 && height > 0) setImageDisplaySize({ width, height });
      }
    });
    observer.observe(image);
    observer.observe(container);
    return () => { active = false; observer.disconnect(); };
  }, [pageIdentity]);

  useEffect(() => {
    if (!fitHeight) return;
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const factor = Math.pow(1.01, -event.deltaY);
      setView(previous => {
        const zoom = Math.min(50, Math.max(1, previous.zoom * factor));
        const ratio = zoom / previous.zoom;
        return { zoom, pan: zoom === 1 ? INITIAL_VIEW.pan : clampPan({
          x: previous.pan.x * ratio, y: previous.pan.y * ratio,
        }, zoom, imageDisplaySize, containerSize) };
      });
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [fitHeight, imageDisplaySize, containerSize, pageIdentity]);

  const canPanZoomedImage = fitHeight && fitZoom > 1 && panEnabled;
  if (isPanning && !canPanZoomedImage) setIsPanning(false);
  useLayoutEffect(() => {
    if (!canPanZoomedImage) releaseGestures();
  }, [canPanZoomedImage, releaseGestures]);
  useEffect(() => {
    window.addEventListener('mouseup', endGestures);
    window.addEventListener('blur', endGestures);
    return () => {
      window.removeEventListener('mouseup', endGestures);
      window.removeEventListener('blur', endGestures);
    };
  }, [endGestures]);

  const handlePanMouseDown = useCallback((event: MouseEvent) => {
    if (!canPanZoomedImage) return;
    event.preventDefault();
    panStart.current = { x: event.clientX - fitPan.x, y: event.clientY - fitPan.y };
    setIsPanning(true);
  }, [canPanZoomedImage, fitPan]);
  const handlePanMouseMove = useCallback((event: MouseEvent) => {
    if (!panStart.current || !canPanZoomedImage) return;
    const pan = { x: event.clientX - panStart.current.x, y: event.clientY - panStart.current.y };
    setView(previous => ({ ...previous, pan: clampPan(pan, previous.zoom, imageDisplaySize, containerSize) }));
  }, [canPanZoomedImage, imageDisplaySize, containerSize]);

  const panToMinimapPoint = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    if (!rect.width || !rect.height || !imageDisplaySize.width || !imageDisplaySize.height) return;
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    setView(previous => ({ ...previous, pan: clampPan({
      x: -(nx - 0.5) * imageDisplaySize.width * previous.zoom,
      y: -(ny - 0.5) * imageDisplaySize.height * previous.zoom,
    }, previous.zoom, imageDisplaySize, containerSize) }));
  }, [imageDisplaySize, containerSize]);
  const handleMinimapPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    minimapDrag.current = { pointerId: event.pointerId, rect, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    panToMinimapPoint(event.clientX, event.clientY, rect);
  }, [panToMinimapPoint]);
  const handleMinimapPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (minimapDrag.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    panToMinimapPoint(event.clientX, event.clientY, minimapDrag.current.rect);
  }, [panToMinimapPoint]);
  const handleMinimapPointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (minimapDrag.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    releaseGestures();
  }, [releaseGestures]);

  const toggleFit = useCallback(() => {
    setFitHeight(value => !value);
    setView(INITIAL_VIEW);
    endGestures();
  }, [endGestures]);
  const minimap = fitHeight && fitZoom > 1 && imageDisplaySize.width > 0 && imageDisplaySize.height > 0 ? {
    left: `${Math.max(0, (0.5 - (containerSize.width / 2 + fitPan.x) / (fitZoom * imageDisplaySize.width)) * 100)}%`,
    top: `${Math.max(0, (0.5 - (containerSize.height / 2 + fitPan.y) / (fitZoom * imageDisplaySize.height)) * 100)}%`,
    width: `${Math.min(100, (containerSize.width / (fitZoom * imageDisplaySize.width)) * 100)}%`,
    height: `${Math.min(100, (containerSize.height / (fitZoom * imageDisplaySize.height)) * 100)}%`,
  } : null;

  return {
    containerRef, imageRef, imageNaturalSize, imageDisplaySize,
    fitHeight, fitZoom, fitPan, isPanning, canPanZoomedImage, toggleFit, minimap,
    handleImageLoad, handlePanMouseDown, handlePanMouseMove, handlePanMouseUp: endGestures,
    handleMinimapPointerDown, handleMinimapPointerMove, handleMinimapPointerEnd,
  };
}
