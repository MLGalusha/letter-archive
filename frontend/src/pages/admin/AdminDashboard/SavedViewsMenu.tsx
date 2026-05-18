import { useRef, useState } from "react";
import Icon from "../../../components/common/Icon";
import DashboardManagerSurface from "./DashboardManagerSurface";
import type { SavedDashboardView } from "./types";

interface SavedViewsMenuProps {
  savedViews: SavedDashboardView[];
  onSaveView: (name: string) => void;
  onApplyView: (view: SavedDashboardView) => void;
  onDeleteView: (viewId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function SavedViewsMenu({
  savedViews,
  onSaveView,
  onApplyView,
  onDeleteView,
  open: controlledOpen,
  onOpenChange,
}: SavedViewsMenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const handleSaveView = () => {
    onSaveView(newViewName.trim() || "Dashboard view");
    setNewViewName("");
    setOpen(false);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <div className="saved-view-menu" ref={containerRef}>
      <button
        className={`dashboard-control-btn saved-view-btn ${open ? "active" : ""}`}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Save view"
      >
        <Icon name="save" size={15} />
        <span>Save view</span>
      </button>

      {open && (
        <DashboardManagerSurface
          title="Views"
          ariaLabel="Saved views"
          closeBoundaryRef={containerRef}
          className="saved-view-popover"
          onClose={handleClose}
        >
          <div className="saved-view-form">
            <input
              type="text"
              placeholder="View name"
              value={newViewName}
              onChange={(event) => setNewViewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSaveView();
                }
              }}
            />
            <button type="button" onClick={handleSaveView}>
              Save
            </button>
          </div>

          <div className="saved-view-list">
            {savedViews.length === 0 ? (
              <div className="saved-view-empty">No saved views</div>
            ) : (
              savedViews.map((view) => (
                <div className="saved-view-item" key={view.id}>
                  <button
                    className="saved-view-load"
                    type="button"
                    onClick={() => {
                      onApplyView(view);
                      setOpen(false);
                    }}
                  >
                    {view.name}
                  </button>
                  <button
                    className="saved-view-delete"
                    type="button"
                    aria-label={`Delete ${view.name}`}
                    onClick={() => onDeleteView(view.id)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </DashboardManagerSurface>
      )}
    </div>
  );
}
