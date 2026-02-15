import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SameNameCandidatesCard from "../SameNameCandidatesCard";

describe("SameNameCandidatesCard", () => {
  it("renders candidate entries and notifies selection", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <SameNameCandidatesCard
        title="Same-Name Candidates"
        note="Check context before merging."
        candidates={[
          { id: "p1", canonicalName: "John Smith", letterCount: 4 },
          { id: "p2", canonicalName: "John Smith", letterCount: 2 },
        ]}
        renderMeta={(candidate) => `${candidate.letterCount} letters`}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Same-Name Candidates")).toBeInTheDocument();
    expect(screen.getAllByText("John Smith")).toHaveLength(2);
    expect(screen.getByText("Check context before merging.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /John Smith/i })[1]);
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("renders nothing when there are no candidates", () => {
    const { container } = render(
      <SameNameCandidatesCard
        title="Same-Name Candidates"
        note="Check context before merging."
        candidates={[]}
        renderMeta={() => ""}
        onSelect={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
