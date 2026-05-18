import { useRef, useState } from "react";
import DashboardManagerSurface from "./DashboardManagerSurface";
import type { PublishCounts } from "./useDashboardSelectionDetails";

interface BulkPublishingMenuProps {
  selectedCount: number;
  bulkActionLoading: boolean;
  publishCounts: PublishCounts;
  onBulkHide: () => void;
  onBulkPublish: () => void;
  onBulkContentVisibility: (field: "transcriptPublished" | "metadataPublished", value: boolean) => void;
}

export default function BulkPublishingMenu({
  selectedCount,
  bulkActionLoading,
  publishCounts,
  onBulkHide,
  onBulkPublish,
  onBulkContentVisibility,
}: BulkPublishingMenuProps) {
  const [showPublishMenu, setShowPublishMenu] = useState(false);
  const publishMenuRef = useRef<HTMLDivElement>(null);

  return (
    <div className="publish-menu-container" ref={publishMenuRef}>
      <button
        type="button"
        className={`toolbar-process-btn${showPublishMenu ? " active" : ""}`}
        onClick={() => setShowPublishMenu((current) => !current)}
        disabled={selectedCount === 0}
      >
        Publishing
      </button>
      {showPublishMenu && (
        <DashboardManagerSurface
          title="Publishing"
          ariaLabel="Publishing actions"
          closeBoundaryRef={publishMenuRef}
          className="publish-menu-dropdown"
          onClose={() => setShowPublishMenu(false)}
        >
          <div className="publish-menu-section">
            <div className="publish-menu-header">
              <span className="publish-menu-label">Letters</span>
              <span className="publish-menu-counts">
                {publishCounts.lettersPublished} published · {publishCounts.lettersHidden} hidden
              </span>
            </div>
            <div className="publish-menu-actions">
              <button
                type="button"
                className="publish-menu-btn publish-menu-btn--unpublish"
                onClick={() => { onBulkHide(); setShowPublishMenu(false); }}
                disabled={bulkActionLoading}
              >
                Hide
              </button>
              <button
                type="button"
                className="publish-menu-btn publish-menu-btn--publish"
                onClick={() => { onBulkPublish(); setShowPublishMenu(false); }}
                disabled={bulkActionLoading}
              >
                Publish
              </button>
            </div>
          </div>
          <div className="publish-menu-divider" />
          <div className="publish-menu-section">
            <div className="publish-menu-header">
              <span className="publish-menu-label">Transcripts</span>
              <span className="publish-menu-counts">
                {publishCounts.transcriptsPublished} published · {publishCounts.transcriptsUnpublished} hidden
              </span>
            </div>
            <div className="publish-menu-actions">
              <button
                type="button"
                className="publish-menu-btn publish-menu-btn--unpublish"
                onClick={() => { onBulkContentVisibility("transcriptPublished", false); setShowPublishMenu(false); }}
                disabled={bulkActionLoading}
              >
                Hide
              </button>
              <button
                type="button"
                className="publish-menu-btn publish-menu-btn--publish"
                onClick={() => { onBulkContentVisibility("transcriptPublished", true); setShowPublishMenu(false); }}
                disabled={bulkActionLoading}
              >
                Publish
              </button>
            </div>
          </div>
          <div className="publish-menu-divider" />
          <div className="publish-menu-section">
            <div className="publish-menu-header">
              <span className="publish-menu-label">Metadata</span>
              <span className="publish-menu-counts">
                {publishCounts.metadataPublished} published · {publishCounts.metadataUnpublished} hidden
              </span>
            </div>
            <div className="publish-menu-actions">
              <button
                type="button"
                className="publish-menu-btn publish-menu-btn--unpublish"
                onClick={() => { onBulkContentVisibility("metadataPublished", false); setShowPublishMenu(false); }}
                disabled={bulkActionLoading}
              >
                Hide
              </button>
              <button
                type="button"
                className="publish-menu-btn publish-menu-btn--publish"
                onClick={() => { onBulkContentVisibility("metadataPublished", true); setShowPublishMenu(false); }}
                disabled={bulkActionLoading}
              >
                Publish
              </button>
            </div>
          </div>
        </DashboardManagerSurface>
      )}
    </div>
  );
}
