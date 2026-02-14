import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import {
  getAllPlaces,
  createPlace,
  updatePlace,
  searchPlaces,
  mergePlaces,
  bulkMergePlaces,
  type PlaceWithCount,
  type EntityMatch,
} from "../../api/entities";
import type { PlaceType } from "../../types/Letter";
import { PLACE_TYPE_OPTIONS } from "../../constants/enums";
import MergeComparison from "../../components/MergeComparison";
import BulkMergeModal from "../../components/BulkMergeModal";
import EntityListPanel from "./EntityManagement/EntityListPanel";
import "./PlacesPage.css";

export default function PlacesPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Main state
  const [places, setPlaces] = useState<PlaceWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Selected place for detail view
  const [selectedPlace, setSelectedPlace] = useState<PlaceWithCount | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkMergeModal, setShowBulkMergeModal] = useState(false);
  const [bulkMerging, setBulkMerging] = useState(false);

  // Merge comparison state
  const [showMergeComparison, setShowMergeComparison] = useState(false);
  const [mergeCompareA, setMergeCompareA] = useState<{ id: string; name: string } | null>(null);
  const [mergeCompareB, setMergeCompareB] = useState<{ id: string; name: string } | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);

  // Refresh trigger for suggestions
  const [refreshKey, setRefreshKey] = useState(0);

  // Form state
  const [formName, setFormName] = useState("");
  const [formAliases, setFormAliases] = useState("");
  const [formPlaceType, setFormPlaceType] = useState<PlaceType | "">("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Merge state
  const [mergeSearchQuery, setMergeSearchQuery] = useState("");
  const [mergeSearchResults, setMergeSearchResults] = useState<EntityMatch[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }
  }, [navigate]);

  // Fetch places
  const fetchPlaces = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getAllPlaces();
      setPlaces(response.places);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to load places",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchPlaces();
  }, [fetchPlaces]);

  // Filtered places
  const filteredPlaces = useMemo(() => {
    if (!searchQuery.trim()) return places;
    const query = searchQuery.toLowerCase();
    return places.filter(
      (p) =>
        p.canonicalName.toLowerCase().includes(query) ||
        p.aliases?.some((a) => a.toLowerCase().includes(query))
    );
  }, [places, searchQuery]);

  // Handle create
  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const aliases = formAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      await createPlace({
        canonicalName: formName.trim(),
        aliases: aliases.length > 0 ? aliases : undefined,
        placeType: formPlaceType || undefined,
        notes: formNotes.trim() || undefined,
      });
      showToast("Place created", "success");
      setShowCreateModal(false);
      resetForm();
      await fetchPlaces();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to create place",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Handle update
  const handleUpdate = async () => {
    if (!selectedPlace || !formName.trim()) return;
    setSaving(true);
    try {
      const aliases = formAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      await updatePlace(selectedPlace.id, {
        canonicalName: formName.trim(),
        aliases,
        placeType: formPlaceType || null,
        notes: formNotes.trim() || null,
      });
      showToast("Place updated", "success");
      setShowEditModal(false);
      await fetchPlaces();
      // Update selected place
      const response = await getAllPlaces();
      const updated = response.places.find((p) => p.id === selectedPlace.id);
      if (updated) setSelectedPlace(updated);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update place",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Handle merge search
  const handleMergeSearch = async () => {
    if (!mergeSearchQuery.trim()) return;
    try {
      const response = await searchPlaces(mergeSearchQuery);
      // Filter out the current place
      setMergeSearchResults(
        response.matches.filter((m) => m.entityId !== selectedPlace?.id)
      );
    } catch {
      showToast("Search failed", "error");
    }
  };

  // Handle merge
  const handleMerge = async () => {
    if (!selectedPlace || !mergeTargetId) return;
    setSaving(true);
    try {
      await mergePlaces(selectedPlace.id, mergeTargetId);
      showToast("Places merged successfully", "success");
      setShowMergeModal(false);
      setMergeTargetId(null);
      setMergeSearchQuery("");
      setMergeSearchResults([]);
      await fetchPlaces();
      setRefreshKey((k) => k + 1);
      // Keep current place selected (it was the "keep" place)
      const response = await getAllPlaces();
      const updated = response.places.find((p) => p.id === selectedPlace.id);
      if (updated) {
        setSelectedPlace(updated);
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to merge places",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Open edit modal
  const openEditModal = () => {
    if (!selectedPlace) return;
    setFormName(selectedPlace.canonicalName);
    setFormAliases(selectedPlace.aliases?.join(", ") || "");
    setFormPlaceType(selectedPlace.placeType || "");
    setFormNotes(selectedPlace.notes || "");
    setShowEditModal(true);
  };

  // Reset form
  const resetForm = () => {
    setFormName("");
    setFormAliases("");
    setFormPlaceType("");
    setFormNotes("");
  };

  // Bulk selection handlers
  const handleToggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredPlaces.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPlaces.map((p) => p.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // Handle bulk merge
  const handleBulkMerge = async (keepId: string, mergeIds: string[]) => {
    setBulkMerging(true);
    try {
      await bulkMergePlaces(keepId, mergeIds);
      showToast(`${mergeIds.length} places merged successfully`, "success");
      setShowBulkMergeModal(false);
      setSelectedIds(new Set());
      await fetchPlaces();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to merge places",
        "error"
      );
    } finally {
      setBulkMerging(false);
    }
  };

  // Handle duplicate suggestion merge
  const handleSuggestionMerge = (keepId: string, mergeId: string, keepName: string, mergeName: string) => {
    setMergeCompareA({ id: keepId, name: keepName });
    setMergeCompareB({ id: mergeId, name: mergeName });
    setShowMergeComparison(true);
  };

  // Handle merge from comparison modal
  const handleComparisonMerge = async (keepId: string, mergeId: string) => {
    setSaving(true);
    try {
      await mergePlaces(keepId, mergeId);
      showToast("Places merged successfully", "success");
      setShowMergeComparison(false);
      setMergeCompareA(null);
      setMergeCompareB(null);
      await fetchPlaces();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to merge places",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Get selected entities for bulk merge modal
  const selectedEntities = useMemo(() => {
    return filteredPlaces
      .filter((p) => selectedIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.canonicalName,
        letterCount: p.letterCount,
        aliases: p.aliases || [],
      }));
  }, [filteredPlaces, selectedIds]);

  return (
    <div className="places-page">
      <div className="page-actions">
        <Button onClick={() => setShowCreateModal(true)}>Add Place</Button>
      </div>

      <div className="page-content">
        {/* Left: Places List */}
        <EntityListPanel
          entityType="place"
          refreshKey={refreshKey}
          onSuggestionMerge={handleSuggestionMerge}
          onRefreshSuggestions={() => setRefreshKey((k) => k + 1)}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchPlaceholder="Search places..."
          items={filteredPlaces}
          loading={loading}
          emptyMessage="No places found"
          selectedEntityId={selectedPlace?.id ?? null}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectItem={setSelectedPlace}
          onSelectAll={handleSelectAll}
          onOpenBulkMerge={() => setShowBulkMergeModal(true)}
          onClearSelection={handleClearSelection}
          panelClassName="places-list-panel"
          listClassName="places-list"
          itemClassName="place-item"
          contentClassName="place-content"
          renderItemContent={(place) => (
            <>
              <div className="place-name">
                {place.canonicalName}
                {place.placeType && (
                  <span className={`place-type-badge ${place.placeType}`}>
                    {PLACE_TYPE_OPTIONS.find((t) => t.value === place.placeType)?.label || place.placeType}
                  </span>
                )}
              </div>
              <div className="place-meta">
                {place.letterCount} letter{place.letterCount !== 1 && "s"}
                {place.aliases && place.aliases.length > 0 && (
                  <span className="aliases-indicator">
                    +{place.aliases.length} alias{place.aliases.length !== 1 && "es"}
                  </span>
                )}
              </div>
            </>
          )}
        />

        {/* Right: Place Detail */}
        <div className="place-detail-panel">
          {selectedPlace ? (
            <>
              <div className="detail-header">
                <h2>{selectedPlace.canonicalName}</h2>
                <div className="detail-actions">
                  <Button variant="secondary" size="sm" onClick={openEditModal}>
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowMergeModal(true)}
                  >
                    Merge
                  </Button>
                </div>
              </div>

              <div className="detail-section">
                <h3>Details</h3>
                <div className="detail-field">
                  <span className="field-label">Letters:</span>
                  <span className="field-value">{selectedPlace.letterCount}</span>
                </div>
                {selectedPlace.placeType && (
                  <div className="detail-field">
                    <span className="field-label">Type:</span>
                    <span className="field-value">
                      {PLACE_TYPE_OPTIONS.find((t) => t.value === selectedPlace.placeType)?.label ||
                        selectedPlace.placeType}
                    </span>
                  </div>
                )}
                {selectedPlace.aliases && selectedPlace.aliases.length > 0 && (
                  <div className="detail-field">
                    <span className="field-label">Aliases:</span>
                    <span className="field-value">
                      {selectedPlace.aliases.join(", ")}
                    </span>
                  </div>
                )}
                {selectedPlace.notes && (
                  <div className="detail-field">
                    <span className="field-label">Notes:</span>
                    <span className="field-value">{selectedPlace.notes}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="no-selection">
              <p>Select a place to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetForm();
        }}
        title="Add Place"
      >
        <div className="modal-form">
          <div className="form-field">
            <label>Name</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Place name"
            />
          </div>
          <div className="form-field">
            <label>Type</label>
            <select
              value={formPlaceType}
              onChange={(e) => setFormPlaceType(e.target.value as PlaceType | "")}
            >
              <option value="">Select type...</option>
              {PLACE_TYPE_OPTIONS.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Aliases (comma-separated)</label>
            <input
              type="text"
              value={formAliases}
              onChange={(e) => setFormAliases(e.target.value)}
              placeholder="Manchester, Mcr"
            />
          </div>
          <div className="form-field">
            <label>Notes</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Additional information..."
              rows={3}
            />
          </div>
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!formName.trim() || saving}>
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Place"
      >
        <div className="modal-form">
          <div className="form-field">
            <label>Name</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Place name"
            />
          </div>
          <div className="form-field">
            <label>Type</label>
            <select
              value={formPlaceType}
              onChange={(e) => setFormPlaceType(e.target.value as PlaceType | "")}
            >
              <option value="">Select type...</option>
              {PLACE_TYPE_OPTIONS.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>Aliases (comma-separated)</label>
            <input
              type="text"
              value={formAliases}
              onChange={(e) => setFormAliases(e.target.value)}
              placeholder="Manchester, Mcr"
            />
          </div>
          <div className="form-field">
            <label>Notes</label>
            <textarea
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Additional information..."
              rows={3}
            />
          </div>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setShowEditModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={!formName.trim() || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Merge Modal */}
      <Modal
        isOpen={showMergeModal}
        onClose={() => {
          setShowMergeModal(false);
          setMergeTargetId(null);
          setMergeSearchQuery("");
          setMergeSearchResults([]);
        }}
        title="Merge Place"
      >
        <div className="modal-form">
          <p className="merge-info">
            Search for places to merge into <strong>{selectedPlace?.canonicalName}</strong>.
            The selected place will be deleted and its associations moved to the current place.
          </p>
          <div className="search-input-row">
            <input
              type="text"
              value={mergeSearchQuery}
              onChange={(e) => setMergeSearchQuery(e.target.value)}
              placeholder="Search for place to merge..."
              onKeyDown={(e) => e.key === "Enter" && handleMergeSearch()}
            />
            <Button onClick={handleMergeSearch}>Search</Button>
          </div>
          <div className="search-results">
            {mergeSearchResults.map((match) => (
              <div
                key={match.entityId}
                className={`search-result ${mergeTargetId === match.entityId ? "selected" : ""}`}
                onClick={() => setMergeTargetId(match.entityId)}
              >
                <span className="result-name">{match.canonicalName}</span>
                <span className="result-similarity">{match.similarity}% match</span>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                setShowMergeModal(false);
                setMergeTargetId(null);
                setMergeSearchQuery("");
                setMergeSearchResults([]);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleMerge}
              disabled={!mergeTargetId || saving}
            >
              {saving ? "Merging..." : "Merge"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Merge Comparison Modal */}
      {mergeCompareA && mergeCompareB && (
        <MergeComparison
          isOpen={showMergeComparison}
          onClose={() => {
            setShowMergeComparison(false);
            setMergeCompareA(null);
            setMergeCompareB(null);
          }}
          entityType="place"
          entityAId={mergeCompareA.id}
          entityBId={mergeCompareB.id}
          entityAName={mergeCompareA.name}
          entityBName={mergeCompareB.name}
          onConfirm={handleComparisonMerge}
        />
      )}

      {/* Bulk Merge Modal */}
      <BulkMergeModal
        isOpen={showBulkMergeModal}
        onClose={() => setShowBulkMergeModal(false)}
        entityType="place"
        selectedEntities={selectedEntities}
        onConfirm={handleBulkMerge}
        loading={bulkMerging}
      />
    </div>
  );
}
