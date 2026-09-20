import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import DuplicateSuggestions from "../DuplicateSuggestions";
import { getDuplicateSuggestions } from "../../../api/entities";

const { showToastMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
}));

vi.mock("../../../contexts/ToastContext", () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock("../../../api/entities", () => ({
  getDuplicateSuggestions: vi.fn(),
}));

function suggestion(name: string) {
  return {
    entityAId: "a",
    entityAName: `${name} A`,
    entityAAliases: [],
    entityALetterCount: 1,
    entityBId: "b",
    entityBName: `${name} B`,
    entityBAliases: [],
    entityBLetterCount: 1,
    similarity: 95,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("DuplicateSuggestions", () => {
  const getDuplicateSuggestionsMock = vi.mocked(getDuplicateSuggestions);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows request ids when duplicate suggestion loading fails", async () => {
    getDuplicateSuggestionsMock.mockRejectedValue(
      new ApiError(503, "Suggestion service unavailable", undefined, "req-suggest-503"),
    );

    render(
      <DuplicateSuggestions
        entityType="person"
        onMerge={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(getDuplicateSuggestionsMock).toHaveBeenCalledWith("person", 50);
    });

    expect(showToastMock).toHaveBeenCalledWith(
      "Suggestion service unavailable (Request ID: req-suggest-503)",
      "error",
    );
    expect(screen.queryByText("Potential Duplicates")).not.toBeInTheDocument();
  });

  it("starts with the new entity type's empty dismissed set when it has no storage", async () => {
    localStorage.setItem("dismissed_duplicates_person", JSON.stringify(["a|b"]));
    getDuplicateSuggestionsMock
      .mockResolvedValueOnce({ suggestions: [suggestion("Person")] })
      .mockResolvedValueOnce({ suggestions: [suggestion("Place")] });
    const props = { onMerge: vi.fn() };
    const { rerender } = render(<DuplicateSuggestions entityType="person" {...props} />);
    await waitFor(() => expect(getDuplicateSuggestionsMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Potential Duplicates")).not.toBeInTheDocument();

    rerender(<DuplicateSuggestions entityType="place" {...props} />);
    fireEvent.click(await screen.findByText("Potential Duplicates"));
    expect(screen.getByText("Place A")).toBeInTheDocument();
  });

  it("ignores suggestions returned for the previous entity type", async () => {
    const personRequest = deferred<{ suggestions: ReturnType<typeof suggestion>[] }>();
    const placeRequest = deferred<{ suggestions: ReturnType<typeof suggestion>[] }>();
    getDuplicateSuggestionsMock
      .mockReturnValueOnce(personRequest.promise)
      .mockReturnValueOnce(placeRequest.promise);
    const props = { onMerge: vi.fn() };
    const { rerender } = render(<DuplicateSuggestions entityType="person" {...props} />);
    await waitFor(() => expect(getDuplicateSuggestionsMock).toHaveBeenCalledWith("person", 50));

    rerender(<DuplicateSuggestions entityType="place" {...props} />);
    await waitFor(() => expect(getDuplicateSuggestionsMock).toHaveBeenCalledWith("place", 50));
    await act(async () => placeRequest.resolve({ suggestions: [suggestion("Current Place")] }));
    fireEvent.click(await screen.findByText("Potential Duplicates"));
    expect(screen.getByText("Current Place A")).toBeInTheDocument();

    await act(async () => personRequest.resolve({ suggestions: [suggestion("Stale Person")] }));
    expect(screen.queryByText("Stale Person A")).not.toBeInTheDocument();
    expect(screen.getByText("Current Place A")).toBeInTheDocument();
  });
});
