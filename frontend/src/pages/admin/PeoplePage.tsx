import { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button, Icon, Modal } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import {
  getAllPersons,
  getRelationshipsForPerson,
  createPerson,
  updatePerson,
  mergePersons,
  searchPersons,
  createRelationship,
  deleteRelationship,
  type PersonWithCount,
  type PersonRelationship,
  type PersonRelationshipType,
  type EntityMatch,
} from "../../api/entities";
import "./PeoplePage.css";

const RELATIONSHIP_TYPES: { value: PersonRelationshipType; label: string }[] = [
  { value: "spouse", label: "Spouse" },
  { value: "fiancé/fiancée", label: "Fiancé/Fiancée" },
  { value: "romantic-partner", label: "Romantic Partner" },
  { value: "parent-child", label: "Parent/Child" },
  { value: "sibling", label: "Sibling" },
  { value: "grandparent-grandchild", label: "Grandparent/Grandchild" },
  { value: "aunt-uncle-niece-nephew", label: "Aunt/Uncle/Niece/Nephew" },
  { value: "cousin", label: "Cousin" },
  { value: "in-law", label: "In-law" },
  { value: "friend", label: "Friend" },
  { value: "acquaintance", label: "Acquaintance" },
  { value: "business-associate", label: "Business Associate" },
  { value: "employer-employee", label: "Employer/Employee" },
  { value: "unknown", label: "Unknown" },
];

export default function PeoplePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Main state
  const [persons, setPersons] = useState<PersonWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Selected person for detail view
  const [selectedPerson, setSelectedPerson] = useState<PersonWithCount | null>(null);
  const [selectedRelationships, setSelectedRelationships] = useState<PersonRelationship[]>([]);
  const [loadingRelationships, setLoadingRelationships] = useState(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showAddRelationshipModal, setShowAddRelationshipModal] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formAliases, setFormAliases] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Merge state
  const [mergeSearchQuery, setMergeSearchQuery] = useState("");
  const [mergeSearchResults, setMergeSearchResults] = useState<EntityMatch[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

  // Add relationship state
  const [relationshipSearchQuery, setRelationshipSearchQuery] = useState("");
  const [relationshipSearchResults, setRelationshipSearchResults] = useState<EntityMatch[]>([]);
  const [relationshipTargetId, setRelationshipTargetId] = useState<string | null>(null);
  const [relationshipType, setRelationshipType] = useState<PersonRelationshipType>("unknown");

  // Auth check
  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }
  }, [navigate]);

  // Fetch persons
  useEffect(() => {
    async function fetchPersons() {
      setLoading(true);
      try {
        const response = await getAllPersons();
        setPersons(response.persons);
      } catch (err) {
        showToast(
          err instanceof Error ? err.message : "Failed to load persons",
          "error"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchPersons();
  }, [showToast]);

  // Fetch relationships when person is selected
  useEffect(() => {
    async function fetchRelationships() {
      if (!selectedPerson) {
        setSelectedRelationships([]);
        return;
      }
      setLoadingRelationships(true);
      try {
        const response = await getRelationshipsForPerson(selectedPerson.id);
        setSelectedRelationships(response.relationships);
      } catch (err) {
        showToast("Failed to load relationships", "error");
      } finally {
        setLoadingRelationships(false);
      }
    }
    fetchRelationships();
  }, [selectedPerson, showToast]);

  // Filtered persons
  const filteredPersons = useMemo(() => {
    if (!searchQuery.trim()) return persons;
    const query = searchQuery.toLowerCase();
    return persons.filter(
      (p) =>
        p.canonicalName.toLowerCase().includes(query) ||
        p.aliases?.some((a) => a.toLowerCase().includes(query))
    );
  }, [persons, searchQuery]);

  // Handle create
  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const aliases = formAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      await createPerson({
        canonicalName: formName.trim(),
        aliases: aliases.length > 0 ? aliases : undefined,
        notes: formNotes.trim() || undefined,
      });
      showToast("Person created", "success");
      setShowCreateModal(false);
      resetForm();
      // Refresh list
      const response = await getAllPersons();
      setPersons(response.persons);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to create person",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Handle update
  const handleUpdate = async () => {
    if (!selectedPerson || !formName.trim()) return;
    setSaving(true);
    try {
      const aliases = formAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      await updatePerson(selectedPerson.id, {
        canonicalName: formName.trim(),
        aliases,
        notes: formNotes.trim() || null,
      });
      showToast("Person updated", "success");
      setShowEditModal(false);
      // Refresh list
      const response = await getAllPersons();
      setPersons(response.persons);
      // Update selected person
      const updated = response.persons.find((p) => p.id === selectedPerson.id);
      if (updated) setSelectedPerson(updated);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update person",
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
      const response = await searchPersons(mergeSearchQuery);
      // Filter out the current person
      setMergeSearchResults(
        response.matches.filter((m) => m.entityId !== selectedPerson?.id)
      );
    } catch (err) {
      showToast("Search failed", "error");
    }
  };

  // Handle merge
  const handleMerge = async () => {
    if (!selectedPerson || !mergeTargetId) return;
    setSaving(true);
    try {
      await mergePersons(selectedPerson.id, mergeTargetId);
      showToast("Persons merged", "success");
      setShowMergeModal(false);
      setMergeTargetId(null);
      setMergeSearchQuery("");
      setMergeSearchResults([]);
      // Refresh list
      const response = await getAllPersons();
      setPersons(response.persons);
      // Update selected person
      const updated = response.persons.find((p) => p.id === selectedPerson.id);
      if (updated) setSelectedPerson(updated);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to merge persons",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Handle relationship search
  const handleRelationshipSearch = async () => {
    if (!relationshipSearchQuery.trim()) return;
    try {
      const response = await searchPersons(relationshipSearchQuery);
      // Filter out the current person
      setRelationshipSearchResults(
        response.matches.filter((m) => m.entityId !== selectedPerson?.id)
      );
    } catch (err) {
      showToast("Search failed", "error");
    }
  };

  // Handle add relationship
  const handleAddRelationship = async () => {
    if (!selectedPerson || !relationshipTargetId) return;
    setSaving(true);
    try {
      await createRelationship({
        personAId: selectedPerson.id,
        personBId: relationshipTargetId,
        relationshipType,
      });
      showToast("Relationship added", "success");
      setShowAddRelationshipModal(false);
      setRelationshipTargetId(null);
      setRelationshipSearchQuery("");
      setRelationshipSearchResults([]);
      setRelationshipType("unknown");
      // Refresh relationships
      const response = await getRelationshipsForPerson(selectedPerson.id);
      setSelectedRelationships(response.relationships);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to add relationship",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  // Handle delete relationship
  const handleDeleteRelationship = async (relationshipId: string) => {
    if (!confirm("Remove this relationship?")) return;
    try {
      await deleteRelationship(relationshipId);
      showToast("Relationship removed", "success");
      // Refresh relationships
      if (selectedPerson) {
        const response = await getRelationshipsForPerson(selectedPerson.id);
        setSelectedRelationships(response.relationships);
      }
    } catch (err) {
      showToast("Failed to remove relationship", "error");
    }
  };

  // Open edit modal
  const openEditModal = () => {
    if (!selectedPerson) return;
    setFormName(selectedPerson.canonicalName);
    setFormAliases(selectedPerson.aliases?.join(", ") || "");
    setFormNotes(selectedPerson.notes || "");
    setShowEditModal(true);
  };

  // Reset form
  const resetForm = () => {
    setFormName("");
    setFormAliases("");
    setFormNotes("");
  };

  // Get related person name from a relationship
  const getRelatedPersonName = (relationship: PersonRelationship) => {
    if (!selectedPerson) return "";
    return relationship.personAId === selectedPerson.id
      ? relationship.personBName
      : relationship.personAName;
  };

  return (
    <div className="people-page">
      <header className="page-header">
        <Link to="/admin" className="back-link">
          <Icon name="back" size={16} />
          <span>Dashboard</span>
        </Link>
        <h1>People</h1>
        <Button onClick={() => setShowCreateModal(true)}>Add Person</Button>
      </header>

      <div className="page-content">
        {/* Left: People List */}
        <div className="people-list-panel">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="loading-state">Loading...</div>
          ) : filteredPersons.length === 0 ? (
            <div className="empty-state">No people found</div>
          ) : (
            <div className="people-list">
              {filteredPersons.map((person) => (
                <div
                  key={person.id}
                  className={`person-item ${selectedPerson?.id === person.id ? "selected" : ""}`}
                  onClick={() => setSelectedPerson(person)}
                >
                  <div className="person-name">{person.canonicalName}</div>
                  <div className="person-meta">
                    {person.letterCount} letter{person.letterCount !== 1 && "s"}
                    {person.aliases && person.aliases.length > 0 && (
                      <span className="aliases-indicator">
                        +{person.aliases.length} alias{person.aliases.length !== 1 && "es"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Person Detail */}
        <div className="person-detail-panel">
          {selectedPerson ? (
            <>
              <div className="detail-header">
                <h2>{selectedPerson.canonicalName}</h2>
                <div className="detail-actions">
                  <Button variant="secondary" size="small" onClick={openEditModal}>
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
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
                  <span className="field-value">{selectedPerson.letterCount}</span>
                </div>
                {selectedPerson.aliases && selectedPerson.aliases.length > 0 && (
                  <div className="detail-field">
                    <span className="field-label">Aliases:</span>
                    <span className="field-value">
                      {selectedPerson.aliases.join(", ")}
                    </span>
                  </div>
                )}
                {selectedPerson.notes && (
                  <div className="detail-field">
                    <span className="field-label">Notes:</span>
                    <span className="field-value">{selectedPerson.notes}</span>
                  </div>
                )}
              </div>

              <div className="detail-section">
                <div className="section-header">
                  <h3>Relationships</h3>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => setShowAddRelationshipModal(true)}
                  >
                    Add
                  </Button>
                </div>
                {loadingRelationships ? (
                  <div className="loading-state">Loading...</div>
                ) : selectedRelationships.length === 0 ? (
                  <div className="empty-state">No relationships</div>
                ) : (
                  <div className="relationships-list">
                    {selectedRelationships.map((rel) => (
                      <div key={rel.id} className="relationship-item">
                        <div className="relationship-info">
                          <span className="relationship-type">
                            {RELATIONSHIP_TYPES.find((t) => t.value === rel.relationshipType)?.label ||
                              rel.relationshipType}
                          </span>
                          <span className="relationship-person">
                            {getRelatedPersonName(rel)}
                          </span>
                        </div>
                        <button
                          className="delete-relationship"
                          onClick={() => handleDeleteRelationship(rel.id)}
                          title="Remove relationship"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="no-selection">
              <p>Select a person to view details</p>
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
        title="Add Person"
      >
        <div className="modal-form">
          <div className="form-field">
            <label>Name</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div className="form-field">
            <label>Aliases (comma-separated)</label>
            <input
              type="text"
              value={formAliases}
              onChange={(e) => setFormAliases(e.target.value)}
              placeholder="John, Johnny, J. Smith"
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
        title="Edit Person"
      >
        <div className="modal-form">
          <div className="form-field">
            <label>Name</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div className="form-field">
            <label>Aliases (comma-separated)</label>
            <input
              type="text"
              value={formAliases}
              onChange={(e) => setFormAliases(e.target.value)}
              placeholder="John, Johnny, J. Smith"
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
        title="Merge Person"
      >
        <div className="modal-form">
          <p className="merge-info">
            Merge another person into <strong>{selectedPerson?.canonicalName}</strong>.
            All letter associations will be moved to this person.
          </p>
          <div className="search-input-row">
            <input
              type="text"
              value={mergeSearchQuery}
              onChange={(e) => setMergeSearchQuery(e.target.value)}
              placeholder="Search for person to merge..."
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
              onClick={handleMerge}
              disabled={!mergeTargetId || saving}
            >
              {saving ? "Merging..." : "Merge"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Relationship Modal */}
      <Modal
        isOpen={showAddRelationshipModal}
        onClose={() => {
          setShowAddRelationshipModal(false);
          setRelationshipTargetId(null);
          setRelationshipSearchQuery("");
          setRelationshipSearchResults([]);
          setRelationshipType("unknown");
        }}
        title="Add Relationship"
      >
        <div className="modal-form">
          <div className="form-field">
            <label>Relationship Type</label>
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value as PersonRelationshipType)}
            >
              {RELATIONSHIP_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="search-input-row">
            <input
              type="text"
              value={relationshipSearchQuery}
              onChange={(e) => setRelationshipSearchQuery(e.target.value)}
              placeholder="Search for related person..."
              onKeyDown={(e) => e.key === "Enter" && handleRelationshipSearch()}
            />
            <Button onClick={handleRelationshipSearch}>Search</Button>
          </div>
          <div className="search-results">
            {relationshipSearchResults.map((match) => (
              <div
                key={match.entityId}
                className={`search-result ${relationshipTargetId === match.entityId ? "selected" : ""}`}
                onClick={() => setRelationshipTargetId(match.entityId)}
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
                setShowAddRelationshipModal(false);
                setRelationshipTargetId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddRelationship}
              disabled={!relationshipTargetId || saving}
            >
              {saving ? "Adding..." : "Add Relationship"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
