import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CollectionCard from "../CollectionCard";
import CollectionModal from "../CollectionModal";
import Lightbox from "../Lightbox";
import UncategorizedCarousel from "../UncategorizedCarousel";
import type { CollectionGroup, EditState, LetterGroup, UploadedImage } from "../types";

function makeImage(id: string, overrides?: Partial<UploadedImage>): UploadedImage {
  return {
    id,
    file: new File(["image-bytes"], `${id}.jpg`, { type: "image/jpeg" }),
    url: `https://example.com/${id}.jpg`,
    originalFilename: `${id}.jpg`,
    parsed: {
      collectionCode: "001",
      dateRaw: "18860314",
      type: "L",
      typeSequence: 1,
      pageNumber: 1,
      letterDate: "1886-03-14",
      dateConfidence: "exact",
    },
    isDuplicate: false,
    replaceSelected: true,
    ...overrides,
  };
}

describe("CollectionCard", () => {
  const collection: CollectionGroup = {
    collectionCode: "001",
    letters: [
      {
        letterKey: "18860314-01",
        dateRaw: "18860314",
        letterDate: "1886-03-14",
        letterPageCount: 1,
        extraCount: 0,
        images: [makeImage("a")],
      },
    ],
    totalImages: 1,
    dateRange: "1886-03-14",
  };

  it("opens in browse mode and selects in edit mode", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSelect = vi.fn();

    const { rerender } = render(
      <CollectionCard
        collection={collection}
        isSelected={false}
        editMode={false}
        allDuplicate={false}
        onSelect={onSelect}
        onClick={onClick}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Collection 001"));
    expect(onClick).toHaveBeenCalled();

    rerender(
      <CollectionCard
        collection={collection}
        isSelected={false}
        editMode
        allDuplicate={false}
        onSelect={onSelect}
        onClick={onClick}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Collection 001"));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("UncategorizedCarousel", () => {
  it("selects image in edit mode", async () => {
    const user = userEvent.setup();
    const image = makeImage("u1");
    const onImageSelect = vi.fn();

    const editState: EditState = {
      active: true,
      selectedCollection: null,
      selectedImageIds: new Set(),
      newCollectionCode: "001",
    };

    render(
      <UncategorizedCarousel
        images={[image]}
        editState={editState}
        onImageSelect={onImageSelect}
        onViewImage={vi.fn()}
        onDeleteImage={vi.fn()}
      />,
    );

    await user.click(screen.getByAltText("u1.jpg"));
    expect(onImageSelect).toHaveBeenCalledWith("u1");
  });
});

describe("CollectionCard allDuplicate", () => {
  const collection: CollectionGroup = {
    collectionCode: "002",
    letters: [
      {
        letterKey: "18860314-01",
        dateRaw: "18860314",
        letterDate: "1886-03-14",
        letterPageCount: 1,
        extraCount: 0,
        images: [makeImage("a", { isDuplicate: true })],
      },
    ],
    totalImages: 1,
    dateRange: "1886-03-14",
  };

  it("applies all-duplicate class when allDuplicate is true", () => {
    const { container } = render(
      <CollectionCard
        collection={collection}
        isSelected={false}
        editMode={false}
        allDuplicate={true}
        onSelect={vi.fn()}
        onClick={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const card = container.querySelector(".collection-card");
    expect(card).toHaveClass("all-duplicate");
  });

  it("does not apply all-duplicate class when allDuplicate is false", () => {
    const { container } = render(
      <CollectionCard
        collection={collection}
        isSelected={false}
        editMode={false}
        allDuplicate={false}
        onSelect={vi.fn()}
        onClick={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const card = container.querySelector(".collection-card");
    expect(card).not.toHaveClass("all-duplicate");
  });
});

describe("Lightbox", () => {
  it("navigates to next image", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <Lightbox
        images={[makeImage("a"), makeImage("b")]}
        currentIndex={0}
        onClose={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.queryByRole("button", { name: "‹" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "›" }));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });
});

describe("CollectionModal", () => {
  function makeLetter(dateRaw: string, allDuplicate: boolean): LetterGroup {
    return {
      letterKey: `${dateRaw}-01`,
      dateRaw,
      letterDate: `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`,
      letterPageCount: 1,
      extraCount: 0,
      images: [
        makeImage(`${dateRaw}-img`, {
          isDuplicate: allDuplicate,
          replaceSelected: true,
          parsed: {
            collectionCode: "001",
            dateRaw,
            type: "L",
            typeSequence: 1,
            pageNumber: 1,
            letterDate: `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`,
            dateConfidence: "exact",
          },
        }),
      ],
    };
  }

  it("sorts non-duplicate letters before all-duplicate letters", () => {
    const collection: CollectionGroup = {
      collectionCode: "001",
      letters: [
        makeLetter("18860314", true),  // all-duplicate
        makeLetter("18860315", false), // non-duplicate
        makeLetter("18860316", true),  // all-duplicate
      ],
      totalImages: 3,
      dateRange: "1886-03-14 - 1886-03-16",
    };

    render(
      <CollectionModal
        collection={collection}
        onClose={vi.fn()}
        onViewImage={vi.fn()}
        onDeleteLetter={vi.fn()}
        onToggleDuplicateReplace={vi.fn()}
      />,
    );

    const cards = screen.getAllByText(/^(March|Unknown)/);
    // Non-duplicate (March 15) should be first
    expect(cards[0].textContent).toContain("15");
    // Duplicates (March 14, March 16) should follow
    expect(cards[1].textContent).toContain("14");
    expect(cards[2].textContent).toContain("16");
  });

  it("applies all-duplicate class to letter cards where all images are duplicates", () => {
    const collection: CollectionGroup = {
      collectionCode: "001",
      letters: [
        makeLetter("18860314", true),
        makeLetter("18860315", false),
      ],
      totalImages: 2,
      dateRange: "1886-03-14 - 1886-03-15",
    };

    const { container } = render(
      <CollectionModal
        collection={collection}
        onClose={vi.fn()}
        onViewImage={vi.fn()}
        onDeleteLetter={vi.fn()}
        onToggleDuplicateReplace={vi.fn()}
      />,
    );

    const letterCards = container.querySelectorAll(".letter-card");
    // First card is the non-duplicate (sorted first)
    expect(letterCards[0]).not.toHaveClass("all-duplicate");
    // Second card is the all-duplicate
    expect(letterCards[1]).toHaveClass("all-duplicate");
  });

  it("does not apply all-duplicate class when letter has mixed images", () => {
    const mixedLetter: LetterGroup = {
      letterKey: "18860314-01",
      dateRaw: "18860314",
      letterDate: "1886-03-14",
      letterPageCount: 2,
      extraCount: 0,
      images: [
        makeImage("dup", {
          isDuplicate: true,
          parsed: { collectionCode: "001", dateRaw: "18860314", type: "L", typeSequence: 1, pageNumber: 1, letterDate: "1886-03-14", dateConfidence: "exact" },
        }),
        makeImage("new", {
          isDuplicate: false,
          parsed: { collectionCode: "001", dateRaw: "18860314", type: "L", typeSequence: 1, pageNumber: 2, letterDate: "1886-03-14", dateConfidence: "exact" },
        }),
      ],
    };

    const collection: CollectionGroup = {
      collectionCode: "001",
      letters: [mixedLetter],
      totalImages: 2,
      dateRange: "1886-03-14",
    };

    const { container } = render(
      <CollectionModal
        collection={collection}
        onClose={vi.fn()}
        onViewImage={vi.fn()}
        onDeleteLetter={vi.fn()}
        onToggleDuplicateReplace={vi.fn()}
      />,
    );

    const letterCard = container.querySelector(".letter-card");
    expect(letterCard).not.toHaveClass("all-duplicate");
  });
});
