import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getErrorMessage } from "../../api/client";
import { Button, Icon, Modal } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import {
  backfillAdminRelationshipsFromLetters,
  getAdminRelationships,
  createAdminRelationship,
  updateAdminRelationship,
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
import {
  buildRelationshipInsights,
  filterRelationships,
} from "./relationships-utils";
import "./RelationshipsPage.css";

type ViewMode = "table" | "graph";

export default function RelationshipsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [relationships, setRelationships] = useState<PersonRelationship[]>([]);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [minConfidence, setMinConfidence] = useState(0);

  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [showConnectionFinder, setShowConnectionFinder] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [personASearch, setPersonASearch] = useState("");
  const [personBSearch, setPersonBSearch] = useState("");
  const [personAResults, setPersonAResults] = useState<EntityMatch[]>([]);
  const [personBResults, setPersonBResults] = useState<EntityMatch[]>([]);
  const [selectedPersonA, setSelectedPersonA] = useState<{ id: string; name: string } | null>(null);
  const [selectedPersonB, setSelectedPersonB] = useState<{ id: string; name: string } | null>(null);
  const [newRelType, setNewRelType] = useState<PersonRelationshipType>("unknown");
  const [newRelConfidence, setNewRelConfidence] = useState(100);
  const [newRelNotes, setNewRelNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRelationship, setEditingRelationship] = useState<PersonRelationship | null>(null);
  const [editRelType, setEditRelType] = useState<PersonRelationshipType>("unknown");
  const [editConfidence, setEditConfidence] = useState(100);
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }
  }, [navigate]);

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
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const insights = useMemo(() => buildRelationshipInsights(relationships), [relationships]);

  const filteredRelationships = useMemo(
    () =>
      filterRelationships(relationships, {
        searchQuery,
        typeFilter,
        minConfidence,
      }),
    [relationships, searchQuery, typeFilter, minConfidence],
  );

  const filteredInsights = useMemo(
    () => buildRelationshipInsights(filteredRelationships),
    [filteredRelationships],
  );

  const openPersonInAdmin = useCallback(
    (personId: string) => {
      navigate(`/admin/entities/people?personId=${personId}`);
    },
    [navigate],
  );

  const handleSearchPersonA = async () => {
    if (!personASearch.trim()) return;
    try {
      const response = await searchPersons(personASearch);
      setPersonAResults(response.matches);
    } catch {
      showToast("Search failed", "error");
    }
  };

  const handleSearchPersonB = async () => {
    if (!personBSearch.trim()) return;
    try {
      const response = await searchPersons(personBSearch);
      setPersonBResults(
        response.matches.filter((m) => m.entityId !== selectedPersonA?.id),
      );
    } catch {
      showToast("Search failed", "error");
    }
  };

  const resetAddForm = () => {
    setPersonASearch("");
    setPersonBSearch("");
    setPersonAResults([]);
    setPersonBResults([]);
    setSelectedPersonA(null);
    setSelectedPersonB(null);
    setNewRelType("unknown");
    setNewRelConfidence(100);
    setNewRelNotes("");
  };

  const handleAddRelationship = async () => {
    if (!selectedPersonA || !selectedPersonB) return;
    setSaving(true);
    try {
      await createAdminRelationship({
        personAId: selectedPersonA.id,
        personBId: selectedPersonB.id,
        relationshipType: newRelType,
        confidence: newRelConfidence,
        notes: newRelNotes.trim() || undefined,
      });
      showToast("Relationship created", "success");
      setShowAddModal(false);
      resetAddForm();
      await fetchData();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to create relationship",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (relationship: PersonRelationship) => {
    setEditingRelationship(relationship);
    setEditRelType(relationship.relationshipType);
    setEditConfidence(relationship.confidence);
    setEditNotes(relationship.notes || "");
    setShowEditModal(true);
  };

  const handleUpdateRelationship = async () => {
    if (!editingRelationship) return;

    setSaving(true);
    try {
      await updateAdminRelationship(editingRelationship.id, {
        relationshipType: editRelType,
        confidence: editConfidence,
        notes: editNotes.trim() || null,
      });
      showToast("Relationship updated", "success");
      setShowEditModal(false);
      setEditingRelationship(null);
      await fetchData();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update relationship",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRelationship = async (id: string) => {
    if (!confirm("Delete this relationship?")) return;
    try {
      await deleteAdminRelationship(id);
      showToast("Relationship deleted", "success");
      await fetchData();
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to delete relationship"), "error");
    }
  };

  const handleBackfillRelationships = async () => {
    setBackfilling(true);
    try {
      const result = await backfillAdminRelationshipsFromLetters();
      showToast(
        `Backfill complete: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped (${result.scannedLetters} scanned)`,
        result.created > 0 || result.updated > 0 ? "success" : "info",
      );
      await fetchData();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to backfill relationships",
        "error",
      );
    } finally {
      setBackfilling(false);
    }
  };

  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? undefined : nodeId));
    setHighlightedPath([]);
  };

  const handleNodeDoubleClick = (nodeId: string) => {
    openPersonInAdmin(nodeId);
  };

  const handlePathFound = useCallback((path: string[]) => {
    setHighlightedPath(path);
  }, []);

  const getRelationshipLabel = (type: PersonRelationshipType) => {
    return PERSON_RELATIONSHIP_OPTIONS.find((t) => t.value === type)?.label || type;
  };

  const confidenceClassName = (confidence: number) => {
    if (confidence >= 90) return "excellent";
    if (confidence >= 70) return "good";
    return "low";
  };

  return (
    <div className="relationships-page">
      <div className="relationships-header">
        <div>
          <p className="relationships-subtitle">
            Maintain people-to-people links, resolve low-confidence edges, and jump directly to entity records.
          </p>
        </div>
        <div className="relationships-header-actions">
          <Button
            variant="secondary"
            onClick={handleBackfillRelationships}
            disabled={backfilling}
          >
            {backfilling ? "Backfilling..." : "Backfill From Letters"}
          </Button>
          <Button onClick={() => setShowAddModal(true)}>Add Relationship</Button>
        </div>
      </div>

      <div className="relationship-summary-grid">
        <article className="summary-card">
          <span className="summary-label">Total Relationships</span>
          <span className="summary-value">{insights.totalRelationships}</span>
        </article>
        <article className="summary-card">
          <span className="summary-label">People Connected</span>
          <span className="summary-value">{insights.uniquePeople}</span>
        </article>
        <article className="summary-card">
          <span className="summary-label">Average Confidence</span>
          <span className="summary-value">{insights.averageConfidence}%</span>
        </article>
        <article className="summary-card warning">
          <span className="summary-label">Needs Review (&lt;70%)</span>
          <span className="summary-value">{insights.lowConfidenceCount}</span>
        </article>
      </div>

      {insights.topTypes.length > 0 && (
        <div className="top-types-row">
          {insights.topTypes.map((entry) => (
            <span key={entry.type} className="type-chip">
              {getRelationshipLabel(entry.type as PersonRelationshipType)} · {entry.count}
            </span>
          ))}
        </div>
      )}

      <div className="view-controls">
        <div className="view-toggle" role="tablist" aria-label="Relationship display mode">
          <button
            className={`toggle-btn ${viewMode === "table" ? "active" : ""}`}
            onClick={() => setViewMode("table")}
            role="tab"
            aria-selected={viewMode === "table"}
          >
            Table
          </button>
          <button
            className={`toggle-btn ${viewMode === "graph" ? "active" : ""}`}
            onClick={() => setViewMode("graph")}
            role="tab"
            aria-selected={viewMode === "graph"}
          >
            Graph
          </button>
        </div>

        {viewMode === "table" ? (
          <div className="table-filters">
            <input
              type="text"
              placeholder="Search names or type..."
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
            <label className="confidence-filter" htmlFor="min-confidence">
              Min confidence
              <input
                id="min-confidence"
                type="range"
                min={0}
                max={100}
                step={5}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
              />
              <span>{minConfidence}%</span>
            </label>
          </div>
        ) : (
          <button
            className={`finder-toggle ${showConnectionFinder ? "active" : ""}`}
            onClick={() => setShowConnectionFinder(!showConnectionFinder)}
          >
            {showConnectionFinder ? "Hide" : "Show"} Connection Finder
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-state">Loading relationships...</div>
      ) : viewMode === "table" ? (
        <div className="table-view">
          {filteredRelationships.length === 0 ? (
            <div className="empty-state">No relationships match your filters</div>
          ) : (
            <table className="relationships-table">
              <thead>
                <tr>
                  <th>Person A</th>
                  <th>Type</th>
                  <th>Person B</th>
                  <th>Confidence</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRelationships.map((rel) => (
                  <tr key={rel.id}>
                    <td>
                      <button
                        type="button"
                        className="person-link"
                        onClick={() => openPersonInAdmin(rel.personAId)}
                      >
                        {rel.personAName}
                      </button>
                    </td>
                    <td>
                      <span className={`rel-type-badge rel-${rel.relationshipType}`}>
                        {getRelationshipLabel(rel.relationshipType)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="person-link"
                        onClick={() => openPersonInAdmin(rel.personBId)}
                      >
                        {rel.personBName}
                      </button>
                    </td>
                    <td>
                      <div className="confidence-cell">
                        <span>{rel.confidence}%</span>
                        <div className="confidence-bar" aria-hidden="true">
                          <span
                            className={`confidence-fill ${confidenceClassName(rel.confidence)}`}
                            style={{ width: `${rel.confidence}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      {rel.notes ? (
                        <span className="notes-preview">{rel.notes}</span>
                      ) : (
                        <span className="notes-empty">-</span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          onClick={() => openEditModal(rel)}
                          title="Edit relationship"
                          aria-label="Edit relationship"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          className="icon-btn delete"
                          onClick={() => handleDeleteRelationship(rel.id)}
                          title="Delete relationship"
                          aria-label="Delete relationship"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="table-summary">
            Showing {filteredRelationships.length} of {relationships.length} relationships ·
            filtered average confidence {filteredInsights.averageConfidence}%
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

          <div className="metadata-row">
            <label>
              Confidence
              <input
                type="number"
                min={0}
                max={100}
                value={newRelConfidence}
                onChange={(e) => setNewRelConfidence(Number(e.target.value))}
              />
            </label>
            <label>
              Notes
              <input
                type="text"
                placeholder="Optional context"
                value={newRelNotes}
                onChange={(e) => setNewRelNotes(e.target.value)}
              />
            </label>
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

      <Modal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingRelationship(null);
        }}
        title="Edit Relationship"
      >
        <div className="modal-form edit-relationship-form">
          {editingRelationship && (
            <p className="edit-context">
              {editingRelationship.personAName} ↔ {editingRelationship.personBName}
            </p>
          )}
          <div className="form-field">
            <label>Relationship type</label>
            <select
              value={editRelType}
              onChange={(e) => setEditRelType(e.target.value as PersonRelationshipType)}
            >
              {PERSON_RELATIONSHIP_OPTIONS.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Confidence</label>
            <input
              type="number"
              min={0}
              max={100}
              value={editConfidence}
              onChange={(e) => setEditConfidence(Number(e.target.value))}
            />
          </div>
          <div className="form-field">
            <label>Notes</label>
            <textarea
              rows={3}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Optional context"
            />
          </div>
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setShowEditModal(false);
                setEditingRelationship(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdateRelationship} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
