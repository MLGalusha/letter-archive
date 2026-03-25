import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LetterCard from "../LetterCard";

vi.mock("../../../api/client", () => ({
  getImageUrl: (url: string) => url,
}));

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("LetterCard", () => {
  it("only cools down a card after the auto-preview fully finishes", async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();

    const { container } = render(
      <LetterCard
        card={{
          id: "letter-1",
          imageType: "letter",
          imageUrl: "/images/page-1.jpg",
          primaryChip: "2 pages",
          sender: "Jimmie",
          recipient: "Molly",
          date: "August 10th, 1947",
          hook: "Jimmie pleads for a reply.",
          searchPreview: {
            excerpt: "Please write soon, Molly.",
            matchCount: 3,
            highlightRanges: [
              {
                start: 19,
                end: 24,
              },
            ],
          },
        }}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", {
      name: /Jimmie → Molly/i,
    });
    const previewToggle = screen.getByRole("button", {
      name: "Show search match preview",
    });

    expect(button).not.toHaveAttribute("title");
    expect(screen.getByText("3 matches")).toBeInTheDocument();
    expect(container.querySelector(".letter-card-search-match-highlight")?.textContent).toBe("Molly");
    expect(button).not.toHaveClass("letter-card--search-preview-visible");

    const shell = button.closest(".letter-card-shell") as HTMLElement;

    fireEvent.mouseEnter(shell);
    expect(button).toHaveClass("letter-card--search-preview-visible");
    expect(window.localStorage.getItem("letter-card-search-preview-cooldowns")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(button).not.toHaveClass("letter-card--search-preview-visible");
    expect(window.localStorage.getItem("letter-card-search-preview-cooldowns")).toContain("letter-1");

    fireEvent.mouseLeave(shell);
    fireEvent.mouseEnter(shell);
    expect(button).not.toHaveClass("letter-card--search-preview-visible");

    fireEvent.mouseEnter(previewToggle);
    expect(button).toHaveClass("letter-card--search-preview-visible");

    fireEvent.mouseLeave(previewToggle);
    expect(button).not.toHaveClass("letter-card--search-preview-visible");

    fireEvent.click(previewToggle);
    expect(button).toHaveClass("letter-card--search-preview-visible");
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledWith("letter-1");
  });

  it("does not cool down a card if the hover ends before the preview finishes", async () => {
    vi.useFakeTimers();

    render(
      <LetterCard
        card={{
          id: "letter-2",
          imageType: "letter",
          imageUrl: "/images/page-2.jpg",
          primaryChip: "2 pages",
          sender: "Jimmie",
          recipient: "Molly",
          date: "August 11th, 1947",
          hook: "Jimmie imagines their future together.",
          searchPreview: {
            excerpt: "Molly, darling, write soon.",
            matchCount: 2,
            highlightRanges: [
              {
                start: 0,
                end: 5,
              },
            ],
          },
        }}
        onClick={() => {}}
      />,
    );

    const button = screen.getByRole("button", {
      name: /August 11th, 1947/i,
    });
    const shell = button.closest(".letter-card-shell") as HTMLElement;

    fireEvent.mouseEnter(shell);
    expect(button).toHaveClass("letter-card--search-preview-visible");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    fireEvent.mouseLeave(shell);
    expect(button).not.toHaveClass("letter-card--search-preview-visible");
    expect(window.localStorage.getItem("letter-card-search-preview-cooldowns")).toBeNull();

    fireEvent.mouseEnter(shell);
    expect(button).toHaveClass("letter-card--search-preview-visible");
  });
});
