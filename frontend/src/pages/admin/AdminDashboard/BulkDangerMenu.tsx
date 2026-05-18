import { useRef, useState } from "react";
import BulkDestructiveControls from "./BulkDestructiveControls";
import DashboardManagerSurface from "./DashboardManagerSurface";
import useFixedToolbarPopover from "./useFixedToolbarPopover";

interface BulkDangerMenuProps {
  selectedCount: number;
  bulkActionLoading: boolean;
  onClearTranscriptions: () => void;
  onClearMetadata: () => void;
  onDelete: () => void;
}

export default function BulkDangerMenu({
  selectedCount,
  bulkActionLoading,
  onClearTranscriptions,
  onClearMetadata,
  onDelete,
}: BulkDangerMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const popoverStyle = useFixedToolbarPopover(open, menuRef);

  return (
    <div className="danger-menu-container" ref={menuRef}>
      <button
        type="button"
        className={`toolbar-btn-destructive${open ? " active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        disabled={selectedCount === 0}
      >
        Danger
      </button>
      {open && (
        <DashboardManagerSurface
          title="Danger zone"
          ariaLabel="Danger actions"
          closeBoundaryRef={menuRef}
          className="danger-menu-dropdown"
          style={popoverStyle}
          onClose={() => setOpen(false)}
        >
          <BulkDestructiveControls
            selectedCount={selectedCount}
            bulkActionLoading={bulkActionLoading}
            onClearTranscriptions={() => {
              onClearTranscriptions();
              setOpen(false);
            }}
            onClearMetadata={() => {
              onClearMetadata();
              setOpen(false);
            }}
            onDelete={() => {
              onDelete();
              setOpen(false);
            }}
          />
        </DashboardManagerSurface>
      )}
    </div>
  );
}
