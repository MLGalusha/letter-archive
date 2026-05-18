import { useEffect } from "react";
import type { ReactNode } from "react";
import Icon from "../../../components/common/Icon";

interface DashboardManagerSurfaceProps {
  title: string;
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}

export default function DashboardManagerSurface({
  title,
  ariaLabel,
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
