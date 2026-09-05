import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LetterCard from "../LetterCard";

vi.mock("../../../api/client", () => ({
  getImageUrl: (url: string) => url,
}));

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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
            matchedFieldLabel: "Transcript",
            highlightRanges: [
              {
                start: 19,
                end: 24,
              },
            ],
            hookHighlightRanges: [
              {
                start: 20,
                end: 25,
              },
            ],
          },
        }}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("link", {
      name: /Jimmie → Molly/i,
    });
    const previewToggle = screen.getByRole("button", {
      name: "Show search match preview",
    });

    expect(button).toHaveAttribute("href", "/letter/letter-1");
    expect(button).not.toHaveAttribute("title");
    expect(screen.queryByText("3 matches")).not.toBeInTheDocument();
    expect(screen.queryByText("Transcript match")).not.toBeInTheDocument();
    expect(container.querySelector(".letter-hook .letter-card-search-match-highlight")?.textContent).toBe("reply");
    expect(button).not.toHaveClass("letter-card--search-preview-visible");

    const shell = button.closest(".letter-card-shell") as HTMLElement;

    fireEvent.mouseEnter(shell);
    expect(button).toHaveClass("letter-card--search-preview-visible");
    expect(screen.getByText("3 matches")).toBeInTheDocument();
    expect(screen.getByText("Transcript match")).toBeInTheDocument();
    expect(screen.getAllByText("Molly").length).toBeGreaterThan(0);
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
            excerpt: "",
            matchCount: 0,
            matchedFieldLabel: "Hook",
            highlightRanges: [],
            hookHighlightRanges: [
              {
                start: 22,
                end: 28,
              },
            ],
          },
        }}
        onClick={() => {}}
      />,
    );

    const button = screen.getByRole("link", {
      name: /August 11th, 1947/i,
    });
    const shell = button.closest(".letter-card-shell") as HTMLElement;
    expect(screen.queryByRole("button", { name: "Show search match preview" })).not.toBeInTheDocument();
    expect(shell).not.toHaveClass("letter-card-shell--has-search-match");
    expect(document.querySelector(".letter-hook .letter-card-search-match-highlight")?.textContent).toBe("future");

    fireEvent.mouseEnter(shell);
    expect(button).not.toHaveClass("letter-card--search-preview-visible");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    fireEvent.mouseLeave(shell);
    expect(button).not.toHaveClass("letter-card--search-preview-visible");
    expect(window.localStorage.getItem("letter-card-search-preview-cooldowns")).toBeNull();

    fireEvent.mouseEnter(shell);
    expect(button).not.toHaveClass("letter-card--search-preview-visible");
  });

  it("renders a subtle sort cue when the archive is sorted by a hidden field", () => {
    render(
      <LetterCard
        card={{
          id: "letter-3",
          imageType: "letter",
          imageUrl: "/images/page-3.jpg",
          primaryChip: "1 page",
          sender: "Jimmie",
          recipient: "Molly",
          date: "August 12th, 1947",
          hook: "A brief note.",
        }}
        sortCue={{
          label: "Collection",
          value: "009",
        }}
        onClick={() => {}}
      />,
    );

    expect(screen.getByText("Collection")).toBeInTheDocument();
    expect(screen.getByText("009")).toBeInTheDocument();
  });

  it("keeps the preview visible while a touch stays inside the card, delays hide on release, and suppresses navigation after a hold", async () => {
    mockMatchMedia(true);
    vi.useFakeTimers();
    const onClick = vi.fn();

    render(
      <LetterCard
        card={{
          id: "letter-4",
          imageType: "letter",
          imageUrl: "/images/page-4.jpg",
          primaryChip: "1 page",
          sender: "Jimmie",
          recipient: "Molly",
          date: "August 13th, 1947",
          hook: "Jimmie begs Molly to answer.",
          searchPreview: {
            excerpt: "Please answer soon, Molly.",
            matchCount: 1,
            matchedFieldLabel: "Transcript",
            highlightRanges: [
              {
                start: 20,
                end: 25,
              },
            ],
          },
        }}
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("link", {
      name: /August 13th, 1947/i,
    });
    const shell = button.closest(".letter-card-shell") as HTMLElement;

    expect(screen.queryByRole("button", { name: "Show search match preview" })).not.toBeInTheDocument();

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => shell),
    });

    fireEvent.touchStart(button, {
      touches: [{ clientX: 20, clientY: 20 }],
    });
    expect(button).toHaveClass("letter-card--search-preview-visible");

    fireEvent.touchMove(button, {
      touches: [{ clientX: 24, clientY: 60 }],
    });
    expect(button).toHaveClass("letter-card--search-preview-visible");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(220);
    });

    fireEvent.touchEnd(button);
    expect(button).toHaveClass("letter-card--search-preview-visible");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(button).toHaveClass("letter-card--search-preview-visible");

    fireEvent.touchStart(button, {
      touches: [{ clientX: 20, clientY: 20 }],
    });
    expect(button).toHaveClass("letter-card--search-preview-visible");

    fireEvent.touchEnd(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(420);
    });
    expect(button).not.toHaveClass("letter-card--search-preview-visible");

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledWith("letter-4");
  });
});
