import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    onOpenTranscription: vi.fn(),
    onOpenMetadataExtraction: vi.fn(),
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

const originalMatchMedia = window.matchMedia;

function mockMobileViewport(isMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isMobile,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("BulkEditToolbar", () => {
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: originalMatchMedia,
    });
  });

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

  it("disables processing actions when the toolbar has no selected letters", () => {
    render(<BulkEditToolbar {...makeToolbarModels({ selectedCount: 0 })} />);

    expect(screen.getByRole("button", { name: "Transcribe" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Extract Metadata" }),
    ).toBeDisabled();
  });

  it("switches to save completion when copy edits are pending", () => {
    render(<BulkEditToolbar {...makeToolbarModels({ pendingChangesCount: 2 })} />);

    expect(screen.getByRole("button", { name: "Save & Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear selection" })).not.toBeInTheDocument();
  });

  it("routes page and filtered selection actions to their handlers", async () => {
    const user = userEvent.setup();
    const models = makeToolbarModels();

    render(<BulkEditToolbar {...models} />);

    await user.click(screen.getByRole("button", { name: "Page (25)" }));
    await user.click(screen.getByRole("button", { name: "All 98" }));

    expect(models.selection.onSelectPage).toHaveBeenCalled();
    expect(models.selection.onSelectAllFiltered).toHaveBeenCalled();
  });

  it("clears selection from the active all-filtered control", async () => {
    const user = userEvent.setup();
    const models = makeToolbarModels();
    models.selection.allFilteredSelected = true;

    render(<BulkEditToolbar {...models} />);

    await user.click(screen.getByRole("button", { name: "All 98 ✓" }));

    expect(models.selection.onClearSelection).toHaveBeenCalled();
  });

  it("keeps the active page-selection control wired to the page selection handler", async () => {
    const user = userEvent.setup();
    const models = makeToolbarModels();
    models.selection.allPageSelected = true;

    render(<BulkEditToolbar {...models} />);

    await user.click(screen.getByRole("button", { name: "Page ✓" }));

    expect(models.selection.onSelectPage).toHaveBeenCalled();
    expect(models.selection.onClearSelection).not.toHaveBeenCalled();
  });

  it("opens publishing actions in the shared manager dialog", async () => {
    const user = userEvent.setup();

    render(<BulkEditToolbar {...makeToolbarModels()} />);

    await user.click(screen.getByRole("button", { name: "Publishing" }));

    expect(screen.getByRole("dialog", { name: "Publishing actions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Publishing" })).toBeInTheDocument();
    expect(screen.getAllByText("1 published · 2 hidden")).toHaveLength(2);
  });

  it("opens destructive actions in a danger manager instead of showing them inline", async () => {
    const user = userEvent.setup();

    render(<BulkEditToolbar {...makeToolbarModels()} />);

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Danger" }));

    expect(screen.getByRole("dialog", { name: "Danger actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Transcripts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Metadata" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("uses a compact mobile selected-state surface with grouped action sheets", async () => {
    const user = userEvent.setup();
    mockMobileViewport(true);

    render(<BulkEditToolbar {...makeToolbarModels()} />);

    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent(/3\s*selected/);
    expect(screen.getByLabelText("Bulk selection and action controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select page (25)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all (98)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Process" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publishing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Danger" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Process" }));
    expect(screen.getByRole("dialog", { name: "Processing actions" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close Process selected" }));
    await user.click(screen.getByRole("button", { name: "Danger" }));
    expect(screen.getByRole("dialog", { name: "Danger actions" })).toBeInTheDocument();
  });
});
