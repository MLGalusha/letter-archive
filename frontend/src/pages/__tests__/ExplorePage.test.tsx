import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();
const getRelationshipGraphMock = vi.fn();
const getRelationshipGraphByCollectionMock = vi.fn();
const listCollectionsMock = vi.fn();

vi.mock("../../api/entities", () => ({
  getRelationshipGraph: (...args: unknown[]) => getRelationshipGraphMock(...args),
  getRelationshipGraphByCollection: (...args: unknown[]) =>
    getRelationshipGraphByCollectionMock(...args),
}));

vi.mock("../../api/collections", () => ({
  listCollections: (...args: unknown[]) => listCollectionsMock(...args),
}));

vi.mock("../../components/RelationshipGraph/RelationshipGraph", () => ({
  default: ({
    nodes,
    edges,
    selectedNodeId,
    highlightedPath,
    onNodeClick,
    onNodeDoubleClick,
  }: {
    nodes: Array<{ id: string; name: string }>;
    edges: Array<{ id: string }>;
    selectedNodeId?: string;
    highlightedPath: string[];
    onNodeClick: (nodeId: string) => void;
    onNodeDoubleClick: (nodeId: string) => void;
  }) => (
    <div>
      <div>
        {`graph:${nodes.length}:${edges.length}:${selectedNodeId ?? "none"}:${highlightedPath.join(">") || "none"}`}
      </div>
      {nodes.map((node) => (
        <div key={node.id}>
          <button type="button" onClick={() => onNodeClick(node.id)}>
            {`Select ${node.name}`}
          </button>
          <button type="button" onClick={() => onNodeDoubleClick(node.id)}>
            {`Open ${node.name}`}
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../../components/ConnectionFinder/ConnectionFinder", () => ({
  default: ({
    persons,
    onPathFound,
  }: {
    persons: Array<{ id: string; name: string }>;
    onPathFound: (path: string[]) => void;
  }) => (
    <div>
      <span>{`finder:${persons.length}`}</span>
      <button type="button" onClick={() => onPathFound(["person-1", "person-2"])}>
        Mock path
      </button>
    </div>
  ),
}));

vi.mock("../../components/Footer/Footer", () => ({
  default: () => <footer>Footer</footer>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import ExplorePage from "../ExplorePage";

describe("ExplorePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    listCollectionsMock.mockResolvedValue([
      {
        id: "collection-9",
        collectionCode: "009",
        title: "Collection Nine",
        letterCount: 3,
      },
      {
        id: "collection-empty",
        collectionCode: "010",
        title: "Empty Collection",
        letterCount: 0,
      },
    ]);

    getRelationshipGraphMock.mockResolvedValue({
      nodes: [
        { id: "person-1", name: "Alice Smith", letterCount: 4 },
        { id: "person-2", name: "Bob Baker", letterCount: 3 },
      ],
      edges: [
        {
          id: "rel-1",
          source: "person-1",
          target: "person-2",
          relationshipType: "friend",
          confidence: 92,
        },
      ],
    });

    getRelationshipGraphByCollectionMock.mockResolvedValue({
      nodes: [
        { id: "person-3", name: "Clara Jones", letterCount: 2 },
        { id: "person-4", name: "David Stone", letterCount: 1 },
      ],
      edges: [
        {
          id: "rel-2",
          source: "person-3",
          target: "person-4",
          relationshipType: "sibling",
          confidence: 88,
        },
      ],
    });
  });

  it("fetches collection-specific graph data when the collection filter changes", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ExplorePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Explore Relationships")).toBeInTheDocument();
    expect(await screen.findByText("graph:2:1:none:none")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Collection:"),
      "collection-9",
    );

    await waitFor(() => {
      expect(getRelationshipGraphByCollectionMock).toHaveBeenCalledWith("collection-9");
    });
    expect(await screen.findByText("graph:2:1:none:none")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Empty Collection/i })).not.toBeInTheDocument();
  });

  it("highlights found paths and navigates from graph interactions", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ExplorePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("graph:2:1:none:none")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Connection Finder" }));
    expect(screen.getByText("finder:2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mock path" }));
    expect(await screen.findByText("graph:2:1:none:person-1>person-2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select Alice Smith" }));
    expect(await screen.findByRole("heading", { name: "Alice Smith" })).toBeInTheDocument();
    expect(screen.getByText("Connections:")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View Full Profile" }));
    await user.click(screen.getByRole("button", { name: "Open Alice Smith" }));

    expect(mockNavigate).toHaveBeenCalledWith("/people/person-1");
    expect(mockNavigate).toHaveBeenCalledWith("/people/person-1");
  });

  it("shows an error state when the relationship graph cannot be loaded", async () => {
    getRelationshipGraphMock.mockRejectedValueOnce(new Error("graph offline"));

    render(
      <MemoryRouter>
        <ExplorePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("graph offline")).toBeInTheDocument();
  });
});
