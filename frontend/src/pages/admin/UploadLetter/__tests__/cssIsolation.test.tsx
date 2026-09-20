import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../../../components/common/ConfirmDialog";
import "../../../../components/common/Modal.css";
import "../../UploadLetterPage.css";
import CollectionModal from "../CollectionModal";
import type { CollectionGroup } from "../types";

const collection: CollectionGroup = {
  collectionCode: "001",
  letters: [],
  totalImages: 0,
  dateRange: "",
};

describe("upload CSS ownership", () => {
  it("keeps the shared small confirmation dialog at its shared size after upload styles load", () => {
    const { container } = render(
      <>
        <ConfirmDialog
          isOpen
          title="Delete upload"
          message="This cannot be undone."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
        <CollectionModal
          collection={collection}
          deletionMode={false}
          deletionImageIds={new Set()}
          onClose={vi.fn()}
          onViewImage={vi.fn()}
          onToggleDeletionLetter={vi.fn()}
          onToggleDeletionImage={vi.fn()}
        />
      </>,
    );

    const confirmation = screen.getByRole("dialog", { name: "Delete upload" });
    const collectionDialog = container.querySelector(".upload-collection-modal");

    expect(getComputedStyle(confirmation).maxWidth).toBe("400px");
    expect(collectionDialog).not.toBeNull();
    expect(getComputedStyle(collectionDialog!).maxWidth).toBe("750px");
  });
});
