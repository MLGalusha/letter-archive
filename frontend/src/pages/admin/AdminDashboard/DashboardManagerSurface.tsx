import { useEffect } from "react";
import type { ReactNode, RefObject } from "react";
import Icon from "../../../components/common/Icon";

interface DashboardManagerSurfaceProps {
  title: string;
  ariaLabel?: string;
  closeBoundaryRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

export default function DashboardManagerSurface({
  title,
  ariaLabel,
  closeBoundaryRef,
  className = "",
  children,
  footer,
  onClose,
}: DashboardManagerSurfaceProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!closeBoundaryRef) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (closeBoundaryRef.current && !closeBoundaryRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeBoundaryRef, onClose]);

  return (
    <div className={`dashboard-manager-surface ${className}`} role="dialog" aria-label={ariaLabel ?? title}>
      <div className="dashboard-manager-header">
        <h2>{title}</h2>
        <button type="button" className="dashboard-manager-close" onClick={onClose} aria-label={`Close ${title}`}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="dashboard-manager-body">
        {children}
      </div>
      {footer && (
        <div className="dashboard-manager-footer">
          {footer}
        </div>
      )}
    </div>
  );
}
