import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import BulkEditToolbar from "../BulkEditToolbar";
import type {
  BulkCompletionToolbarModel,
  BulkCopyToolbarModel,
  BulkDangerToolbarModel,
  BulkProcessingToolbarModel,
  BulkPublishingToolbarModel,
  BulkSelectionToolbarModel,
} from "../BulkEditToolbar";

function makeToolbarModels({
  selectedCount = 3,
  pendingChangesCount = 0,
}: {
  selectedCount?: number;
  pendingChangesCount?: number;
} = {}) {
  const selection: BulkSelectionToolbarModel = {
    selectedCount,
    pageCount: 25,
    totalCount: 98,
    allPageSelected: false,
    allFilteredSelected: false,
    onSelectPage: vi.fn(),
    onSelectAllFiltered: vi.fn(),
    onClearSelection: vi.fn(),
  };

  const copy: BulkCopyToolbarModel = {
    copyModeActive: false,
    copiedValue: null,
    sourceCell: null,
    pendingChangesCount,
    isSaving: false,
    onToggleCopyMode: vi.fn(),
  };

  const processing: BulkProcessingToolbarModel = {
    processingStatus: null,
    pausePending: false,
    abortPending: false,
    onOpenTranscription: vi.fn(),
    onOpenMetadataExtraction: vi.fn(),
    onPauseProcessing: vi.fn(),
    onResumeProcessing: vi.fn(),
    onAbortProcessing: vi.fn(),
  };

  const publishing: BulkPublishingToolbarModel = {
    bulkActionLoading: false,
    publishCounts: {
      lettersPublished: 1,
      lettersHidden: 2,
      transcriptsPublished: 1,
      transcriptsUnpublished: 2,
      metadataPublished: 0,
      metadataUnpublished: 3,
    },
    onBulkHide: vi.fn(),
    onBulkPublish: vi.fn(),
    onBulkContentVisibility: vi.fn(),
  };

  const danger: BulkDangerToolbarModel = {
    bulkActionLoading: false,
    onClearTranscriptions: vi.fn(),
    onClearMetadata: vi.fn(),
    onDelete: vi.fn(),
  };

  const completion: BulkCompletionToolbarModel = {
    pendingChangesCount,
    isSaving: false,
    onDone: vi.fn(),
    onExit: vi.fn(),
  };

  return { selection, copy, processing, publishing, danger, completion };
}

describe("BulkEditToolbar", () => {
  it("renders grouped bulk-action sections as one named region", () => {
    render(<BulkEditToolbar {...makeToolbarModels()} />);

    expect(screen.getByRole("region", { name: "Bulk actions" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("3 selected");

    for (const label of ["Selection actions", "Edit actions", "Process actions", "Publish actions", "Danger actions"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("keeps the close action explicit when there are no pending copy edits", async () => {
    const user = userEvent.setup();
    const models = makeToolbarModels();

    render(<BulkEditToolbar {...models} />);

    await user.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(models.completion.onExit).toHaveBeenCalled();
  });

  it("switches to save completion when copy edits are pending", () => {
    render(<BulkEditToolbar {...makeToolbarModels({ pendingChangesCount: 2 })} />);

    expect(screen.getByRole("button", { name: "Save & Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear selection" })).not.toBeInTheDocument();
  });
});
