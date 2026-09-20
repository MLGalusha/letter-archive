import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CollectionModal from "../CollectionModal";

describe("CollectionModal", () => {
  it("formats date-only letter dates without shifting the calendar day", () => {
    render(
      <CollectionModal
        collection={{
          collectionCode: "001",
          letters: [
            {
              letterKey: "18860314-01",
              dateRaw: "18860314-01",
              letterDate: "1886-03-14",
              letterPageCount: 1,
              extraCount: 0,
              images: [],
            },
          ],
          totalImages: 1,
          dateRange: "1886-03-14",
        }}
        deletionMode={false}
        deletionImageIds={new Set()}
        onClose={vi.fn()}
        onViewImage={vi.fn()}
        onToggleDeletionLetter={vi.fn()}
        onToggleDeletionImage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("March 14, 1886"));

    expect(screen.getByText("March 14, 1886")).toBeInTheDocument();
  });
});
