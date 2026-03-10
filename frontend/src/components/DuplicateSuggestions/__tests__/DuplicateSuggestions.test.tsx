import { render, screen, waitFor } from "@testing-library/react";
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
});
