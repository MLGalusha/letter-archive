import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button, Icon, Modal } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import {
  getAllPlaces,
  createPlace,
  updatePlace,
  searchPlaces,
  type PlaceWithCount,
  type EntityMatch,
} from "../../api/entities";
import type { PlaceType } from "../../types/Letter";
import "./PlacesPage.css";

const PLACE_TYPES: { value: PlaceType; label: string }[] = [
  { value: "city", label: "City" },
  { value: "region", label: "Region/State" },
  { value: "country", label: "Country" },
  { value: "street", label: "Street/Address" },
  { value: "landmark", label: "Landmark" },
  { value: "other", label: "Other" },
];

export default function PlacesPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Main state
  const [places, setPlaces] = useState<PlaceWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Selected place for detail view
  const [selectedPlace, setSelectedPlace] = useState<PlaceWithCount | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);

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
  useEffect(() => {
    async function fetchPlaces() {
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
    }
    fetchPlaces();
  }, [showToast]);

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
      // Refresh list
      const response = await getAllPlaces();
      setPlaces(response.places);
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
      // Refresh list
      const response = await getAllPlaces();
      setPlaces(response.places);
      // Update selected place
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
    } catch (err) {
      showToast("Search failed", "error");
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

  return (
    <div className="places-page">
      <header className="page-header">
        <Link to="/admin" className="back-link">
          <Icon name="back" size={16} />
          <span>Dashboard</span>
        </Link>
        <h1>Places</h1>
        <Button onClick={() => setShowCreateModal(true)}>Add Place</Button>
      </header>

      <div className="page-content">
        {/* Left: Places List */}
        <div className="places-list-panel">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search places..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="loading-state">Loading...</div>
          ) : filteredPlaces.length === 0 ? (
            <div className="empty-state">No places found</div>
          ) : (
            <div className="places-list">
              {filteredPlaces.map((place) => (
                <div
                  key={place.id}
                  className={`place-item ${selectedPlace?.id === place.id ? "selected" : ""}`}
                  onClick={() => setSelectedPlace(place)}
                >
                  <div className="place-name">
                    {place.canonicalName}
                    {place.placeType && (
                      <span className={`place-type-badge ${place.placeType}`}>
                        {PLACE_TYPES.find((t) => t.value === place.placeType)?.label || place.placeType}
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
                </div>
              ))}
            </div>
          )}
        </div>

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
                      {PLACE_TYPES.find((t) => t.value === selectedPlace.placeType)?.label ||
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
              {PLACE_TYPES.map((type) => (
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
              {PLACE_TYPES.map((type) => (
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
            Note: Place merging is not yet implemented in the backend.
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
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={true}
              title="Not yet implemented"
            >
              Merge (Coming Soon)
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
