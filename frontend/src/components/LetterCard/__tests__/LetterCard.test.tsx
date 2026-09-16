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

const previewCard = {
  id: 'letter-1', imageType: 'letter' as const, imageUrl: '/images/page-1.jpg',
  sender: 'Jimmie', recipient: 'Molly', hook: 'Please write soon, Molly.',
  searchPreview: { excerpt: 'Please write soon, Molly.', matchCount: 1, matchedFieldLabel: 'Transcript',
    highlightRanges: [{ start: 19, end: 24 }], hookHighlightRanges: [{ start: 19, end: 24 }] },
};

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("LetterCard", () => {
  it("keeps admin picker cards as buttons even with modified clicks", () => {
    const onClick = vi.fn();
    render(<LetterCard selection card={{ id: "pick-1", imageType: "letter", title: "Pick me" }} onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Letter" });
    expect(button).not.toHaveAttribute("href");
    fireEvent.click(button, { ctrlKey: true });
    expect(onClick).toHaveBeenCalledWith("pick-1");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps explanations available until dismissal and never highlights the hook", async () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    const { container } = render(<LetterCard card={previewCard} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search match preview' }));
    expect(screen.getByRole('region', { name: 'Search match preview' })).toHaveTextContent('Transcript match');
    expect(container.querySelector('.letter-hook mark')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
    expect(screen.getByRole('region')).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("exposes a persistent preview and restores focus when Escape dismisses its text", () => {
    render(<LetterCard card={previewCard} onClick={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Search match preview' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const preview = screen.getByRole('region', { name: 'Search match preview' });
    expect(toggle).toHaveAttribute('aria-controls', preview.id);
    expect(toggle).toHaveAttribute('aria-describedby', preview.id);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    preview.focus();
    fireEvent.keyDown(preview, { key: 'Escape' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it("keeps a hovered preview open after its text receives keyboard focus", () => {
    render(<LetterCard card={previewCard} onClick={vi.fn()} />);
    const shell = screen.getByRole('link').closest('.letter-card-shell')!;
    const over = new Event('pointerover', { bubbles: true });
    Object.defineProperty(over, 'pointerType', { value: 'mouse' });
    fireEvent(shell, over);
    const preview = screen.getByRole('region');
    act(() => preview.focus());
    fireEvent.pointerLeave(shell);
    expect(preview).toHaveFocus();
    expect(preview).toBeVisible();
    fireEvent.keyDown(preview, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Search match preview' })).toHaveFocus();
  });

  it("clears stale preview state when the search evidence changes", () => {
    const { rerender } = render(<LetterCard card={previewCard} onClick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search match preview' }));
    rerender(<LetterCard card={{ ...previewCard, searchPreview: undefined }} onClick={vi.fn()} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

  it("provides touch users the same explicit preview control without intercepting letter navigation", () => {
    mockMatchMedia(true);
    const onClick = vi.fn();
    render(<LetterCard card={previewCard} onClick={onClick} />);
    const toggle = screen.getByRole('button', { name: 'Search match preview' });
    fireEvent.click(toggle);
    expect(screen.getByRole('region')).toBeVisible();
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link'));
    expect(onClick).toHaveBeenCalledWith('letter-1');
  });
});
