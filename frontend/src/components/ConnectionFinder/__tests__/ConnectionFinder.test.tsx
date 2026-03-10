import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../../../api/client";
import ConnectionFinder from "../ConnectionFinder";
import { findConnectionPath } from "../../../api/entities";

vi.mock("../../../api/entities", () => ({
  findConnectionPath: vi.fn(),
}));

const people = [
  { id: "person-a", name: "Alice Smith" },
  { id: "person-b", name: "Bob Baker" },
  { id: "person-c", name: "Carol Clark" },
];

function renderFinder() {
  const onPathFound = vi.fn();
  render(<ConnectionFinder persons={people} onPathFound={onPathFound} />);
  return { onPathFound };
}

function selectPerson(inputIndex: number, query: string, name: string) {
  const input = screen.getAllByPlaceholderText("Search by name...")[inputIndex];
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByText(name));
}

describe("ConnectionFinder", () => {
  const findConnectionPathMock = vi.mocked(findConnectionPath);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-searches once both people are selected and reports the highlighted path", async () => {
    findConnectionPathMock.mockResolvedValue({
      path: [
        { id: "person-a", name: "Alice Smith" },
        { id: "person-b", name: "Bob Baker" },
        { id: "person-c", name: "Carol Clark" },
      ],
      edges: [
        { id: "edge-1", type: "friend" },
        { id: "edge-2", type: "business-associate" },
      ],
    });

    const { onPathFound } = renderFinder();

    selectPerson(0, "alice", "Alice Smith");
    selectPerson(1, "carol", "Carol Clark");

    await waitFor(() => {
      expect(findConnectionPathMock).toHaveBeenCalledWith("person-a", "person-c");
    });

    expect(await screen.findByText("Connection Path (2 degrees)")).toBeInTheDocument();
    expect(screen.getByText("is friend of")).toBeInTheDocument();
    expect(screen.getByText("is business associate of")).toBeInTheDocument();
    expect(onPathFound).toHaveBeenCalledWith(["person-a", "person-b", "person-c"]);
  });

  it("filters out the already-selected person from the opposite chooser", () => {
    renderFinder();

    selectPerson(0, "alice", "Alice Smith");

    const secondInput = screen.getAllByPlaceholderText("Search by name...")[1];
    fireEvent.change(secondInput, { target: { value: "alice" } });

    expect(screen.getByText("No matches found")).toBeInTheDocument();
  });

  it("shows no-connection results and clears state back to empty", async () => {
    findConnectionPathMock.mockResolvedValue({
      path: [],
      edges: [],
      message: "No family link found",
    });

    const { onPathFound } = renderFinder();

    selectPerson(0, "alice", "Alice Smith");
    selectPerson(1, "bob", "Bob Baker");

    expect(await screen.findByText("No family link found")).toBeInTheDocument();
    expect(onPathFound).toHaveBeenCalledWith([]);

    fireEvent.click(screen.getByText("Clear"));

    expect(screen.queryByText("No family link found")).toBeNull();
    expect(screen.getAllByPlaceholderText("Search by name...")[0]).toHaveValue("");
    expect(screen.getAllByPlaceholderText("Search by name...")[1]).toHaveValue("");
    expect(onPathFound).toHaveBeenLastCalledWith([]);
  });

  it("surfaces API failures without reporting a highlighted path", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    findConnectionPathMock.mockRejectedValue(
      new ApiError(503, "graph offline", undefined, "req-graph-503"),
    );

    const { onPathFound } = renderFinder();

    selectPerson(0, "alice", "Alice Smith");
    selectPerson(1, "bob", "Bob Baker");

    expect(
      await screen.findByText("graph offline (Request ID: req-graph-503)"),
    ).toBeInTheDocument();
    expect(onPathFound).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
