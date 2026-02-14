import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CollectionCard from "../CollectionCard";
import Lightbox from "../Lightbox";
import UncategorizedCarousel from "../UncategorizedCarousel";
import type { CollectionGroup, EditState, UploadedImage } from "../types";

function makeImage(id: string): UploadedImage {
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
