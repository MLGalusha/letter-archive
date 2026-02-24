import { useState, useMemo, useCallback, useEffect } from "react";
import ImageThumbnail from "./ImageThumbnail";
import type { UploadedImage, EditState } from "./types";

interface UncategorizedCarouselProps {
  images: UploadedImage[];
  editState: EditState;
  onImageSelect: (id: string) => void;
  onViewImage: (image: UploadedImage, allImages: UploadedImage[]) => void;
  onToggleDeletionImage: (id: string) => void;
}

export default function UncategorizedCarousel({
  images,
  editState,
  onImageSelect,
  onViewImage,
  onToggleDeletionImage,
}: UncategorizedCarouselProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [previousPageIndex, setPreviousPageIndex] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null);

  const VISIBLE_COUNT = 6;
  const totalPages = Math.ceil(images.length / VISIBLE_COUNT);

  const currentImages = useMemo(() => {
    const start = pageIndex * VISIBLE_COUNT;
    return images.slice(start, start + VISIBLE_COUNT);
  }, [images, pageIndex]);

  const previousImages = useMemo(() => {
    if (previousPageIndex === null) return [];
    const start = previousPageIndex * VISIBLE_COUNT;
    return images.slice(start, start + VISIBLE_COUNT);
  }, [images, previousPageIndex]);

  const goToPrev = useCallback(() => {
    if (isAnimating || totalPages <= 1) return;
    setPreviousPageIndex(pageIndex);
    setSlideDirection("right");
    setIsAnimating(true);
    setPageIndex((prev) => (prev - 1 + totalPages) % totalPages);
  }, [isAnimating, totalPages, pageIndex]);

  const goToNext = useCallback(() => {
    if (isAnimating || totalPages <= 1) return;
    setPreviousPageIndex(pageIndex);
    setSlideDirection("left");
    setIsAnimating(true);
    setPageIndex((prev) => (prev + 1) % totalPages);
  }, [isAnimating, totalPages, pageIndex]);

  useEffect(() => {
    if (isAnimating) {
      const timer = setTimeout(() => setIsAnimating(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isAnimating, pageIndex]);

  const showNav = totalPages > 1;

  return (
    <div className="uncategorized-section">
      <div className="uncategorized-header">
        <h2>Uncategorized ({images.length})</h2>
        {showNav && (
          <span className="page-indicator">
            {pageIndex + 1} / {totalPages}
          </span>
        )}
      </div>
      <div className="carousel-container">
        {showNav && (
          <button
            className="carousel-nav carousel-nav-prev"
            onClick={goToPrev}
            aria-label="Previous page"
          >
            ‹
          </button>
        )}
        <div className="uncategorized-carousel">
          <div className={`carousel-slider ${isAnimating && slideDirection ? `animating slide-${slideDirection}` : ""}`}>
            {isAnimating && slideDirection === "left" && (
              <div className="carousel-track">
                {previousImages.map((image) => (
                  <ImageThumbnail
                    key={image.id}
                    image={image}
                    isSelected={editState.selectedImageIds.has(image.id)}
                    editMode={editState.active && editState.mode === "organize"}
                    deletionMode={editState.active && editState.mode === "delete"}
                    onSelect={() => onImageSelect(image.id)}
                    onView={() => onViewImage(image, images)}
                    isMarkedForDeletion={editState.deletionImageIds.has(image.id)}
                    onToggleDeletion={() => onToggleDeletionImage(image.id)}
                  />
                ))}
              </div>
            )}

            <div className="carousel-track">
              {currentImages.map((image) => (
                <ImageThumbnail
                  key={image.id}
                  image={image}
                  isSelected={editState.selectedImageIds.has(image.id)}
                  editMode={editState.active}
                  deletionMode={editState.active && editState.mode === "delete"}
                  onSelect={() => onImageSelect(image.id)}
                  onView={() => onViewImage(image, images)}
                  isMarkedForDeletion={editState.deletionImageIds.has(image.id)}
                  onToggleDeletion={() => onToggleDeletionImage(image.id)}
                />
              ))}
            </div>

            {isAnimating && slideDirection === "right" && (
              <div className="carousel-track">
                {previousImages.map((image) => (
                  <ImageThumbnail
                    key={image.id}
                    image={image}
                    isSelected={editState.selectedImageIds.has(image.id)}
                    editMode={editState.active && editState.mode === "organize"}
                    deletionMode={editState.active && editState.mode === "delete"}
                    onSelect={() => onImageSelect(image.id)}
                    onView={() => onViewImage(image, images)}
                    isMarkedForDeletion={editState.deletionImageIds.has(image.id)}
                    onToggleDeletion={() => onToggleDeletionImage(image.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {showNav && (
          <button
            className="carousel-nav carousel-nav-next"
            onClick={goToNext}
            aria-label="Next page"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}
