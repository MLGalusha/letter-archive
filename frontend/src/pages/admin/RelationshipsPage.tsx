import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button, Icon, Modal } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import {
  getAdminRelationships,
  createAdminRelationship,
  deleteAdminRelationship,
  searchPersons,
  getRelationshipGraph,
  type PersonRelationship,
  type EntityMatch,
  type GraphNode,
  type GraphEdge,
} from "../../api/entities";
import { PERSON_RELATIONSHIP_OPTIONS } from "../../constants/enums";
import type { PersonRelationshipType } from "../../types/Letter";
import RelationshipGraph from "../../components/RelationshipGraph/RelationshipGraph";
import ConnectionFinder from "../../components/ConnectionFinder/ConnectionFinder";
import "./RelationshipsPage.css";

type ViewMode = "table" | "graph";

export default function RelationshipsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // Data
  const [relationships, setRelationships] = useState<PersonRelationship[]>([]);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Graph state
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [showConnectionFinder, setShowConnectionFinder] = useState(false);

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [personASearch, setPersonASearch] = useState("");
  const [personBSearch, setPersonBSearch] = useState("");
  const [personAResults, setPersonAResults] = useState<EntityMatch[]>([]);
  const [personBResults, setPersonBResults] = useState<EntityMatch[]>([]);
  const [selectedPersonA, setSelectedPersonA] = useState<{ id: string; name: string } | null>(null);
  const [selectedPersonB, setSelectedPersonB] = useState<{ id: string; name: string } | null>(null);
  const [newRelType, setNewRelType] = useState<PersonRelationshipType>("unknown");
  const [saving, setSaving] = useState(false);

  // Auth check
  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }
  }, [navigate]);

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [relData, graphResult] = await Promise.all([
        getAdminRelationships(),
        getRelationshipGraph(),
      ]);
      setRelationships(relData);
      setGraphData(graphResult);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to load relationships",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filtered relationships
  const filteredRelationships = useMemo(() => {
    return relationships.filter((rel) => {
      // Type filter
      if (typeFilter !== "all" && rel.relationshipType !== typeFilter) return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          rel.personAName.toLowerCase().includes(query) ||
          rel.personBName.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [relationships, typeFilter, searchQuery]);

  // Search for person A
  const handleSearchPersonA = async () => {
    if (!personASearch.trim()) return;
    try {
      const response = await searchPersons(personASearch);
      setPersonAResults(response.matches);
    } catch {
      showToast("Search failed", "error");
    }
  };

  // Search for person B
  const handleSearchPersonB = async () => {
    if (!personBSearch.trim()) return;
    try {
      const response = await searchPersons(personBSearch);
      // Filter out person A
      setPersonBResults(
        response.matches.filter((m) => m.entityId !== selectedPersonA?.id)
      );
    } catch {
      showToast("Search failed", "error");
    }
  };

  // Handle add relationship
  const handleAddRelationship = async () => {
    if (!selectedPersonA || !selectedPersonB) return;
    setSaving(true);
    try {
      await createAdminRelationship({
        personAId: selectedPersonA.id,
        personBId: selectedPersonB.id,
        relationshipType: newRelType,
      });
      showToast("Relationship created", "success");
      setShowAddModal(false);
      resetAddForm();
      fetchData();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to create relationship",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Handle delete relationship
  const handleDeleteRelationship = async (id: string) => {
    if (!confirm("Delete this relationship?")) return;
    try {
      await deleteAdminRelationship(id);
      showToast("Relationship deleted", "success");
      fetchData();
    } catch {
      showToast("Failed to delete relationship", "error");
    }
  };

  // Reset add form
  const resetAddForm = () => {
    setPersonASearch("");
    setPersonBSearch("");
    setPersonAResults([]);
    setPersonBResults([]);
    setSelectedPersonA(null);
    setSelectedPersonB(null);
    setNewRelType("unknown");
  };

  // Graph handlers
  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? undefined : nodeId));
    setHighlightedPath([]);
  };

  const handleNodeDoubleClick = (_nodeId: string) => {
    navigate(`/admin/entities/people`);
    // In a full implementation, we'd navigate to the specific person
  };

  const handlePathFound = (path: string[]) => {
    setHighlightedPath(path);
  };

  const getRelationshipLabel = (type: PersonRelationshipType) => {
    return PERSON_RELATIONSHIP_OPTIONS.find((t) => t.value === type)?.label || type;
  };

  return (
    <div className="relationships-page">
      <div className="page-actions">
        <Button onClick={() => setShowAddModal(true)}>Add Relationship</Button>
      </div>

      <div className="view-controls">
        <div className="view-toggle">
          <button
            className={`toggle-btn ${viewMode === "table" ? "active" : ""}`}
            onClick={() => setViewMode("table")}
          >
            Table
          </button>
          <button
            className={`toggle-btn ${viewMode === "graph" ? "active" : ""}`}
            onClick={() => setViewMode("graph")}
          >
            Graph
          </button>
        </div>

        {viewMode === "table" && (
          <div className="table-filters">
            <input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="type-filter"
              aria-label="Filter by relationship type"
            >
              <option value="all">All Types</option>
              {PERSON_RELATIONSHIP_OPTIONS.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {viewMode === "graph" && (
          <button
            className={`finder-toggle ${showConnectionFinder ? "active" : ""}`}
            onClick={() => setShowConnectionFinder(!showConnectionFinder)}
          >
            {showConnectionFinder ? "Hide" : "Show"} Connection Finder
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-state">Loading...</div>
      ) : viewMode === "table" ? (
        <div className="table-view">
          {filteredRelationships.length === 0 ? (
            <div className="empty-state">No relationships found</div>
          ) : (
            <table className="relationships-table">
              <thead>
                <tr>
                  <th>Person A</th>
                  <th>Relationship</th>
                  <th>Person B</th>
                  <th>Confidence</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRelationships.map((rel) => (
                  <tr key={rel.id}>
                    <td>{rel.personAName}</td>
                    <td>
                      <span className={`rel-type-badge rel-${rel.relationshipType}`}>
                        {getRelationshipLabel(rel.relationshipType)}
                      </span>
                    </td>
                    <td>{rel.personBName}</td>
                    <td>{rel.confidence}%</td>
                    <td>
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteRelationship(rel.id)}
                        title="Delete"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="table-summary">
            {filteredRelationships.length} relationship{filteredRelationships.length !== 1 ? "s" : ""}
            {typeFilter !== "all" && ` (filtered)`}
          </div>
        </div>
      ) : (
        <div className="graph-view">
          {showConnectionFinder && (
            <div className="connection-finder-container">
              <ConnectionFinder
                persons={graphData.nodes.map((n) => ({ id: n.id, name: n.name }))}
                onPathFound={handlePathFound}
              />
            </div>
          )}
          <div className="graph-wrapper">
            {graphData.nodes.length === 0 ? (
              <div className="empty-state">No relationships to display</div>
            ) : (
              <RelationshipGraph
                nodes={graphData.nodes}
                edges={graphData.edges}
                width={900}
                height={600}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={handleNodeDoubleClick}
                selectedNodeId={selectedNodeId}
                highlightedPath={highlightedPath}
              />
            )}
          </div>
        </div>
      )}

      {/* Add Relationship Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          resetAddForm();
        }}
        title="Add Relationship"
        size="lg"
      >
        <div className="add-relationship-form">
          <div className="person-select-row">
            {/* Person A */}
            <div className="person-select">
              <label>Person A</label>
              {selectedPersonA ? (
                <div className="selected-person">
                  {selectedPersonA.name}
                  <button onClick={() => setSelectedPersonA(null)}>×</button>
                </div>
              ) : (
                <>
                  <div className="search-row">
                    <input
                      type="text"
                      value={personASearch}
                      onChange={(e) => setPersonASearch(e.target.value)}
                      placeholder="Search..."
                      onKeyDown={(e) => e.key === "Enter" && handleSearchPersonA()}
                    />
                    <Button size="sm" onClick={handleSearchPersonA}>
                      Search
                    </Button>
                  </div>
                  {personAResults.length > 0 && (
                    <ul className="search-results">
                      {personAResults.map((match) => (
                        <li
                          key={match.entityId}
                          onClick={() => {
                            setSelectedPersonA({ id: match.entityId, name: match.canonicalName });
                            setPersonAResults([]);
                          }}
                        >
                          {match.canonicalName} ({match.similarity}%)
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            {/* Relationship Type */}
            <div className="relationship-type-select">
              <label>Type</label>
              <select
                value={newRelType}
                onChange={(e) => setNewRelType(e.target.value as PersonRelationshipType)}
              >
                {PERSON_RELATIONSHIP_OPTIONS.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Person B */}
            <div className="person-select">
              <label>Person B</label>
              {selectedPersonB ? (
                <div className="selected-person">
                  {selectedPersonB.name}
                  <button onClick={() => setSelectedPersonB(null)}>×</button>
                </div>
              ) : (
                <>
                  <div className="search-row">
                    <input
                      type="text"
                      value={personBSearch}
                      onChange={(e) => setPersonBSearch(e.target.value)}
                      placeholder="Search..."
                      onKeyDown={(e) => e.key === "Enter" && handleSearchPersonB()}
                    />
                    <Button size="sm" onClick={handleSearchPersonB}>
                      Search
                    </Button>
                  </div>
                  {personBResults.length > 0 && (
                    <ul className="search-results">
                      {personBResults.map((match) => (
                        <li
                          key={match.entityId}
                          onClick={() => {
                            setSelectedPersonB({ id: match.entityId, name: match.canonicalName });
                            setPersonBResults([]);
                          }}
                        >
                          {match.canonicalName} ({match.similarity}%)
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setShowAddModal(false);
                resetAddForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddRelationship}
              disabled={!selectedPersonA || !selectedPersonB || saving}
            >
              {saving ? "Creating..." : "Create Relationship"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
