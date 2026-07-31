import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  TranscriptAlignmentItem,
  TranscriptAlignmentPageResponse,
  TranscriptAlignmentPoint,
  TranscriptAlignmentSegment,
  TranscriptAlignmentUnassignedReason,
} from '../../../api/admin/transcriptAlignment';
import {
  centeredAlignmentScrollTarget,
  containedZoomSurfaceSize,
  unionSegmentBounds,
  type AlignmentSurfaceSize,
} from './zoomNavigation';

interface TranscriptAlignmentCanvasProps {
  page: TranscriptAlignmentPageResponse;
  imageUrl: string;
  selectedItemId: string | null;
  zoom: number;
  onSelectItem: (itemId: string) => void;
  correctionMode?: boolean;
  correctionSegmentIds?: string[];
  onToggleCorrectionSegment?: (segmentId: string) => void;
  disabled?: boolean;
  onImageError?: () => void;
}

function pointsValue(points: TranscriptAlignmentPoint[]): string {
  return points.map(({ x, y }) => `${x},${y}`).join(' ');
}

function selectableItemsForSegment(
  items: TranscriptAlignmentItem[],
  segmentId: string,
): TranscriptAlignmentItem[] {
  return items
    .filter((item) => item.mapping.segmentIds.includes(segmentId))
    .sort((left, right) => left.sourceLineNumber - right.sourceLineNumber);
}

function segmentDisplayStatus(
  items: TranscriptAlignmentItem[],
  segmentId: string,
  selectedItemId: string | null,
  skippedSegmentIds: Set<string>,
  deferredSegmentIds: Set<string>,
): 'selected' | 'ambiguous' | 'accepted' | 'deferred' | 'skipped' | 'unassigned' {
  const mappedItems = selectableItemsForSegment(items, segmentId);
  if (mappedItems.some((item) => item.id === selectedItemId)) return 'selected';
  if (mappedItems.some((item) => item.mapping.status === 'ambiguous')) return 'ambiguous';
  if (mappedItems.some((item) => item.mapping.status === 'accepted')) return 'accepted';
  if (deferredSegmentIds.has(segmentId)) return 'deferred';
  if (skippedSegmentIds.has(segmentId)) return 'skipped';
  return 'unassigned';
}

function segmentLabel(
  segment: TranscriptAlignmentSegment,
  mappedItems: TranscriptAlignmentItem[],
): string {
  const lineLabel = segment.readingOrderIndex === null
    ? 'Detected image line'
    : `Detected image line ${segment.readingOrderIndex + 1}`;
  if (mappedItems.length === 0) {
    return `${lineLabel}, not matched to transcript text`;
  }
  const transcriptLines = mappedItems
    .map((item) => item.sourceLineNumber)
    .join(', ');
  return `${lineLabel}, matched to transcript line${mappedItems.length > 1 ? 's' : ''} ${transcriptLines}`;
}

function unassignedReasonDescription(
  reason: TranscriptAlignmentUnassignedReason,
): string {
  switch (reason) {
    case 'secondary-flow':
      return 'unassigned because it belongs to a separate text flow';
    case 'transcript-mismatch':
      return 'unassigned because the page transcript and detected text do not correspond closely enough';
    case 'non-transcribed-text':
      return 'unassigned because this appears to be document text that was not transcribed';
    case 'alignment-uncertain':
      return 'unassigned because the alignment evidence was uncertain';
    case 'deferred-orientation':
      return 'deferred for rotated text review';
  }
}

function SegmentShape({
  segment,
  status,
}: {
  segment: TranscriptAlignmentSegment;
  status: ReturnType<typeof segmentDisplayStatus>;
}) {
  return (
    <>
      {segment.boundary.length >= 3 ? (
        <polygon
          className="transcript-alignment-segment-boundary"
          data-segment-id={segment.id}
          data-status={status}
          points={pointsValue(segment.boundary)}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {segment.baseline && segment.baseline.length >= 2 ? (
        <polyline
          className="transcript-alignment-segment-baseline"
          data-status={status}
          points={pointsValue(segment.baseline)}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </>
  );
}

export default function TranscriptAlignmentCanvas({
  page,
  imageUrl,
  selectedItemId,
  zoom,
  onSelectItem,
  correctionMode = false,
  correctionSegmentIds = [],
  onToggleCorrectionSegment,
  disabled = false,
  onImageError,
}: TranscriptAlignmentCanvasProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceSize, setSurfaceSize] = useState<AlignmentSurfaceSize>({
    width: 0,
    height: 0,
  });
  const skippedSegmentIds = useMemo(
    () => new Set(page.skippedSegmentIds),
    [page.skippedSegmentIds],
  );
  const deferredSegmentIds = useMemo(
    () => new Set(page.deferredSegmentIds),
    [page.deferredSegmentIds],
  );
  const selectedItem = useMemo(
    () => page.items.find((item) => item.id === selectedItemId) ?? null,
    [page.items, selectedItemId],
  );
  const savedCorrectionSegmentIds = useMemo(
    () => (
      selectedItem?.review?.verdict === 'incorrect'
        ? selectedItem.review.correctSegmentIds
        : []
    ),
    [selectedItem],
  );
  const selectedProposalSegmentIds = useMemo(
    () => selectedItem?.mapping.segmentIds ?? [],
    [selectedItem],
  );
  const selectedSegmentIds = useMemo(() => {
    if (correctionMode && correctionSegmentIds.length > 0) {
      return correctionSegmentIds;
    }
    if (savedCorrectionSegmentIds.length > 0) {
      return savedCorrectionSegmentIds;
    }
    return selectedProposalSegmentIds;
  }, [
    correctionMode,
    correctionSegmentIds,
    savedCorrectionSegmentIds,
    selectedProposalSegmentIds,
  ]);
  const selectedBounds = useMemo(
    () => unionSegmentBounds(page.segments, selectedSegmentIds),
    [page.segments, selectedSegmentIds],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    const scrollContainer = surface?.closest<HTMLElement>(
      '.transcript-alignment-image-scroll',
    );
    if (!scrollContainer) return undefined;

    const updateSize = () => {
      setSurfaceSize(containedZoomSurfaceSize({
        viewportWidth: scrollContainer.clientWidth,
        viewportHeight: scrollContainer.clientHeight,
        imageWidth: page.page.image.width,
        imageHeight: page.page.image.height,
        zoom,
      }));
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(scrollContainer);
    return () => resizeObserver.disconnect();
  }, [
    page.page.image.height,
    page.page.image.width,
    zoom,
  ]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const scrollContainer = surface?.closest<HTMLElement>(
      '.transcript-alignment-image-scroll',
    );
    if (
      !surface
      || !scrollContainer
      || surfaceSize.width <= 0
      || surfaceSize.height <= 0
    ) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      const target = centeredAlignmentScrollTarget({
        viewportWidth: scrollContainer.clientWidth,
        viewportHeight: scrollContainer.clientHeight,
        contentWidth: scrollContainer.scrollWidth,
        contentHeight: scrollContainer.scrollHeight,
        surfaceLeft: surface.offsetLeft,
        surfaceTop: surface.offsetTop,
        surfaceWidth: surface.offsetWidth,
        surfaceHeight: surface.offsetHeight,
        imageWidth: page.page.image.width,
        imageHeight: page.page.image.height,
        bounds: selectedBounds,
      });
      const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollContainer.scrollTo?.({
        ...target,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    page.page.image.height,
    page.page.image.width,
    selectedBounds,
    selectedItemId,
    surfaceSize,
    zoom,
  ]);

  const chooseSegment = (segmentId: string) => {
    if (disabled) return;
    if (correctionMode) {
      onToggleCorrectionSegment?.(segmentId);
      return;
    }
    const mappedItems = selectableItemsForSegment(page.items, segmentId);
    if (mappedItems.length === 0) return;
    if (mappedItems.some((item) => item.id === selectedItemId)) return;
    const firstConnectedItem = mappedItems[0];
    if (firstConnectedItem) onSelectItem(firstConnectedItem.id);
  };

  return (
    <div
      ref={surfaceRef}
      className="transcript-alignment-canvas-zoom"
      data-testid="alignment-canvas-zoom"
      style={{
        width: surfaceSize.width > 0 ? `${surfaceSize.width}px` : '100%',
        height: surfaceSize.height > 0 ? `${surfaceSize.height}px` : '100%',
      }}
    >
      <svg
        className="transcript-alignment-canvas"
        viewBox={`0 0 ${page.page.image.width} ${page.page.image.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`Transcript alignment for ${page.page.pageKey}`}
      >
        <image
          href={imageUrl}
          width={page.page.image.width}
          height={page.page.image.height}
          preserveAspectRatio="none"
          onError={onImageError}
        />
        <g className="transcript-alignment-segments">
          {page.segments.map((segment) => {
            const mappedItems = selectableItemsForSegment(page.items, segment.id);
            const status = segmentDisplayStatus(
              page.items,
              segment.id,
              selectedItemId,
              skippedSegmentIds,
              deferredSegmentIds,
            );
            const correctionSelected = correctionSegmentIds.includes(segment.id);
            const savedCorrectionSelected = (
              !correctionMode
              && savedCorrectionSegmentIds.includes(segment.id)
            );
            const rejectedProposal = (
              !correctionMode
              && selectedItem?.review?.verdict === 'incorrect'
              && selectedProposalSegmentIds.includes(segment.id)
              && !savedCorrectionSelected
            );
            const canSelect = correctionMode || mappedItems.length > 0;
            const baseLabel = segmentLabel(segment, mappedItems);
            const unassignedExplanation = (
              mappedItems.length === 0 && segment.unassignedReason
                ? unassignedReasonDescription(segment.unassignedReason)
                : null
            );
            const accessibleLabel = correctionMode
              ? `${correctionSelected ? 'Remove' : 'Select'} ${baseLabel} as corrected geometry`
              : savedCorrectionSelected
                ? `${baseLabel}, saved corrected location for transcript line ${selectedItem?.sourceLineNumber}`
                : rejectedProposal
                  ? `${baseLabel}, rejected algorithm proposal`
                  : unassignedExplanation
                    ? `${baseLabel}, ${unassignedExplanation}`
                    : status === 'deferred'
                    ? `${baseLabel}, deferred for rotated text review`
                    : baseLabel;
            return (
              <g
                key={segment.id}
                className={[
                  'transcript-alignment-segment',
                  `is-${status}`,
                  correctionMode ? 'is-correction-available' : '',
                  correctionSelected ? 'is-correction-selected' : '',
                  savedCorrectionSelected ? 'is-saved-correction' : '',
                  rejectedProposal ? 'is-rejected-proposal' : '',
                  disabled ? 'is-disabled' : '',
                ].filter(Boolean).join(' ')}
                role={canSelect ? 'button' : 'img'}
                tabIndex={canSelect && !disabled ? 0 : undefined}
                aria-label={accessibleLabel}
                aria-pressed={correctionMode && canSelect ? correctionSelected : undefined}
                aria-disabled={canSelect && disabled ? true : undefined}
                data-unassigned-reason={segment.unassignedReason}
                onClick={canSelect ? () => chooseSegment(segment.id) : undefined}
                onKeyDown={canSelect ? (event) => {
                  if (disabled) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    chooseSegment(segment.id);
                  }
                } : undefined}
              >
                <title>{accessibleLabel}</title>
                <SegmentShape segment={segment} status={status} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
