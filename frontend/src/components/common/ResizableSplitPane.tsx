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
  const splitRatioRef = useRef(splitRatio);
  const letterIdRef = useRef(letterId);

  // Store handlers in refs for proper cleanup
  const mouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpRef = useRef<(() => void) | null>(null);

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

  // Calculate new split ratio based on mouse/touch position
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

  // Cleanup function for mouse handlers
  const cleanupMouseHandlers = useCallback(() => {
    if (mouseMoveRef.current) {
      document.removeEventListener("mousemove", mouseMoveRef.current);
      mouseMoveRef.current = null;
    }
    if (mouseUpRef.current) {
      document.removeEventListener("mouseup", mouseUpRef.current);
      mouseUpRef.current = null;
    }
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    setIsDragging(false);
  }, []);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      // Clean up any existing handlers first
      cleanupMouseHandlers();

      setIsDragging(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        updateSplitRatio(moveEvent.clientX, moveEvent.clientY);
      };

      const handleMouseUp = () => {
        cleanupMouseHandlers();
      };

      // Store refs for cleanup
      mouseMoveRef.current = handleMouseMove;
      mouseUpRef.current = handleMouseUp;

      // Prevent text selection during drag
      document.body.style.userSelect = "none";
      document.body.style.cursor = isMobile ? "row-resize" : "grabbing";

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [isMobile, updateSplitRatio, cleanupMouseHandlers]
  );

  // Cleanup on unmount or when isDragging becomes false unexpectedly
  useEffect(() => {
    return () => {
      cleanupMouseHandlers();
    };
  }, [cleanupMouseHandlers]);

  // Touch handlers
  const handleTouchStart = useCallback(
    (_e: React.TouchEvent) => {
      setIsDragging(true);

      const handleTouchMove = (moveEvent: TouchEvent) => {
        const touch = moveEvent.touches[0];
        updateSplitRatio(touch.clientX, touch.clientY);
      };

      const handleTouchEnd = () => {
        setIsDragging(false);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
      };

      document.addEventListener("touchmove", handleTouchMove, { passive: true });
      document.addEventListener("touchend", handleTouchEnd);
    },
    [updateSplitRatio]
  );

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
        className={`split-pane-divider ${isDragging ? "dragging" : ""}`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      />

      <div className={`split-pane-second ${secondPanelClassName}`}>{children[1]}</div>
    </div>
  );
}

export type { ResizableSplitPaneProps };
