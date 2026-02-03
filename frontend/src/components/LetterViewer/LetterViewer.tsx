import { useState, useRef, useEffect } from "react";
import type { LetterImage } from "../../types/Letter";
import { getImageUrl } from "../../api/client";
import "./LetterViewer.css";

interface LetterViewerProps {
  images: LetterImage[];
  showOnlyLetterPages?: boolean;
}

export default function LetterViewer({
  images,
  showOnlyLetterPages = false,
}: LetterViewerProps) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isLocked, setIsLocked] = useState(true);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Filter images if needed
  const displayImages = showOnlyLetterPages
    ? images.filter((img) => img.type === "letter_page")
    : images;

  const currentImage = displayImages[currentImageIndex];

  // Reset zoom and position when changing images
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, [currentImageIndex]);

  // Global wheel event listener for image zoom when unlocked
  useEffect(() => {
    const handleGlobalWheel = (e: WheelEvent) => {
      if (!isLocked && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY * -0.01;
        const newScale = Math.min(Math.max(1, scale + delta), 5);

        setScale(newScale);

        if (newScale === 1) {
          setPosition({ x: 0, y: 0 });
        }
      }
    };

    window.addEventListener("wheel", handleGlobalWheel, { passive: false });

    return () => {
      window.removeEventListener("wheel", handleGlobalWheel);
    };
  }, [isLocked, scale]);

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % displayImages.length);
  };

  const prevImage = () => {
    setCurrentImageIndex(
      (prev) => (prev - 1 + displayImages.length) % displayImages.length
    );
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isLocked || scale === 1) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || isLocked) return;

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
    if (isLocked || scale === 1) return;

    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({
      x: touch.clientX - position.x,
      y: touch.clientY - position.y,
    });
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging || isLocked) return;

    const touch = e.touches[0];
    setPosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const toggleLock = () => {
    setIsLocked(!isLocked);
  };

  if (!currentImage) {
    return <div className="letter-viewer-empty">No images available</div>;
  }

  return (
    <div className="letter-viewer">
      <div
        ref={imageContainerRef}
        className={`viewer-container ${isDragging ? "dragging" : ""} ${
          isLocked ? "locked" : ""
        }`}
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
          className="viewer-image"
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${
              position.y / scale
            }px)`,
            cursor: isLocked
              ? "default"
              : scale > 1
              ? isDragging
                ? "grabbing"
                : "grab"
              : "default",
          }}
          draggable={false}
        />

        {/* Single bottom overlay - all controls */}
        <div className="viewer-overlay">
          <button
            onClick={toggleLock}
            className={`lock-button ${isLocked ? "locked" : ""}`}
            title={isLocked ? "Unlock zoom and pan" : "Lock zoom and pan"}
          >
            {isLocked ? "🔒" : "🔓"}
          </button>
          {scale > 1 && !isLocked && (
            <span className="zoom-indicator">{Math.round(scale * 100)}%</span>
          )}
          <span className="image-type-label">
            {currentImage.type.replace(/_/g, " ")}
          </span>
          {displayImages.length > 1 && (
            <>
              <button onClick={prevImage} className="nav-button">
                ←
              </button>
              <span className="image-counter">
                {currentImageIndex + 1} / {displayImages.length}
              </span>
              <button onClick={nextImage} className="nav-button">
                →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
