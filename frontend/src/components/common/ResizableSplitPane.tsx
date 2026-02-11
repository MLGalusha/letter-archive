import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import "./ResizableSplitPane.css";

// ============================================================================
// TYPES
// ============================================================================

interface ResizableSplitPaneProps {
  children: [ReactNode, ReactNode];
  defaultSplit?: number; // 0-1, default 0.6
  minFirstPanel?: number; // default 0.4
  minSecondPanel?: number; // default 0.3
  gap?: string; // default 'var(--spacing-lg)'
  className?: string;
  firstPanelClassName?: string;
  secondPanelClassName?: string;
  letterId?: string; // for localStorage persistence
  onSplitChange?: (ratio: number) => void;
}

// ============================================================================
// LOCALSTORAGE HELPERS
// ============================================================================

const STORAGE_KEY = "letterViewerState";

interface StoredState {
  letterId: string;
  images: Record<string, { scale: number; position: { x: number; y: number } }>;
  splitRatio?: number;
}

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

// ============================================================================
// COMPONENT
// ============================================================================

export function ResizableSplitPane({
  children,
  defaultSplit = 0.6,
  minFirstPanel = 0.4,
  minSecondPanel = 0.3,
  gap = "var(--spacing-lg)",
  className = "",
  firstPanelClassName = "",
  secondPanelClassName = "",
  letterId,
  onSplitChange,
}: ResizableSplitPaneProps) {
  // Determine if mobile (vertical split) or desktop (horizontal split)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Initialize split ratio from localStorage if same letter, else use default
  const [splitRatio, setSplitRatio] = useState(() => {
    if (letterId) {
      const stored = loadStoredState();
      if (stored && stored.letterId === letterId && stored.splitRatio !== undefined) {
        return stored.splitRatio;
      }
    }
    return defaultSplit;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const splitRatioRef = useRef(splitRatio);
  const letterIdRef = useRef(letterId);
  const isDraggingRef = useRef(false); // Ref for use in document event listeners

  // Keep refs in sync
  useEffect(() => {
    splitRatioRef.current = splitRatio;
  }, [splitRatio]);

  useEffect(() => {
    letterIdRef.current = letterId;
  }, [letterId]);

  // Handle letter change - load or reset split ratio
  useEffect(() => {
    if (!letterId) return;

    const stored = loadStoredState();
    if (stored && stored.letterId === letterId && stored.splitRatio !== undefined) {
      setSplitRatio(stored.splitRatio);
    } else {
      setSplitRatio(defaultSplit);
    }
  }, [letterId, defaultSplit]);

  // Save split ratio to localStorage (debounced)
  useEffect(() => {
    if (!letterId) return;

    const timeoutId = setTimeout(() => {
      const stored = loadStoredState();
      const newState: StoredState = {
        letterId,
        images: stored?.letterId === letterId ? stored.images : {},
        splitRatio: splitRatioRef.current,
      };
      saveStoredState(newState);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [splitRatio, letterId]);

  // Detect window resize for mobile/desktop switch
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Calculate new split ratio based on pointer position
  const updateSplitRatio = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      let newRatio: number;

      if (isMobile) {
        // Vertical split - use Y position
        newRatio = (clientY - rect.top) / rect.height;
      } else {
        // Horizontal split - use X position
        newRatio = (clientX - rect.left) / rect.width;
      }

      // Clamp to min/max constraints
      const minFirst = isMobile ? 0.3 : minFirstPanel;
      const minSecond = isMobile ? 0.3 : minSecondPanel;
      newRatio = Math.max(minFirst, Math.min(1 - minSecond, newRatio));

      setSplitRatio(newRatio);
      onSplitChange?.(newRatio);
    },
    [isMobile, minFirstPanel, minSecondPanel, onSplitChange]
  );

  // ============================================================================
  // POINTER EVENT HANDLERS (using setPointerCapture for reliable drag)
  // ============================================================================
  // Using Pointer Events with setPointerCapture guarantees that the divider
  // element will receive ALL pointer events until pointerup, regardless of
  // where the pointer moves. This solves issues with contentEditable,
  // scrollable containers, and other elements that might interfere.
  // See: https://javascript.info/pointer-events
  // ============================================================================

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only handle primary button (left click / touch)
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      // Capture all pointer events to this element until pointerup
      // This is the key to making drag work reliably!
      e.currentTarget.setPointerCapture(e.pointerId);

      setIsDragging(true);
      isDraggingRef.current = true;

      // Prevent text selection during drag
      document.body.style.userSelect = "none";
      document.body.style.cursor = isMobile ? "row-resize" : "grabbing";
    },
    [isMobile]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only process if we're dragging (have pointer capture)
      if (!isDragging) return;

      e.preventDefault();
      updateSplitRatio(e.clientX, e.clientY);
    },
    [isDragging, updateSplitRatio]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;

      e.preventDefault();

      // Release pointer capture (also happens automatically on pointerup)
      e.currentTarget.releasePointerCapture(e.pointerId);

      setIsDragging(false);
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [isDragging]
  );

  // Handle pointer cancel (e.g., if browser interrupts the drag)
  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setIsDragging(false);
      isDraggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    []
  );

  // ============================================================================
  // FALLBACK: Document-level mouse/pointer listeners
  // ============================================================================
  // In some browsers/situations, setPointerCapture doesn't reliably deliver
  // pointerup to the element (e.g., when releasing over contentEditable).
  // This fallback ensures we catch the release event no matter what.
  // ============================================================================

  useEffect(() => {
    const handleDocumentPointerUp = () => {
      if (isDraggingRef.current) {
        setIsDragging(false);
        isDraggingRef.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };

    const handleDocumentMouseUp = () => {
      if (isDraggingRef.current) {
        setIsDragging(false);
        isDraggingRef.current = false;
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    };

    // Listen on both pointer and mouse events for maximum compatibility
    document.addEventListener("pointerup", handleDocumentPointerUp, true);
    document.addEventListener("mouseup", handleDocumentMouseUp, true);

    return () => {
      document.removeEventListener("pointerup", handleDocumentPointerUp, true);
      document.removeEventListener("mouseup", handleDocumentMouseUp, true);
    };
  }, []);

  // Calculate panel sizes
  const firstSize = isMobile
    ? `${splitRatio * 100}%`
    : `calc(${splitRatio * 100}% - ${gap} / 2)`;
  const secondSize = isMobile
    ? `${(1 - splitRatio) * 100}%`
    : `calc(${(1 - splitRatio) * 100}% - ${gap} / 2)`;

  // Calculate divider position (for desktop, it's positioned after the first panel)
  const dividerPosition = `${splitRatio * 100}%`;

  return (
    <div
      ref={containerRef}
      className={`split-pane ${isMobile ? "split-pane-vertical" : "split-pane-horizontal"} ${
        isDragging ? "dragging" : ""
      } ${className}`}
      style={
        {
          "--first-size": firstSize,
          "--second-size": secondSize,
          "--split-percent": dividerPosition,
          "--split-gap": gap,
          "--first-height": isMobile ? firstSize : undefined,
        } as React.CSSProperties
      }
    >
      <div className={`split-pane-first ${firstPanelClassName}`}>{children[0]}</div>

      <div
        ref={dividerRef}
        className={`split-pane-divider ${isDragging ? "dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        // Prevent native behaviors
        onDragStart={(e) => e.preventDefault()}
        draggable={false}
        // touch-action CSS prevents browser gestures from interfering
        style={{ touchAction: "none" }}
      />

      <div className={`split-pane-second ${secondPanelClassName}`}>{children[1]}</div>
    </div>
  );
}

export type { ResizableSplitPaneProps };
