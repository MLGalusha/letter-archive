import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isAuthenticated } from "../../api/auth";
import { getErrorMessage } from "../../api/client";
import { Button, Icon, Modal } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import {
  getAllPersons,
  getPersonById,
  getPersonSameNameCandidates,
  createPerson,
  updatePerson,
  mergePersons,
  bulkMergePersons,
  undoPersonAction,
  searchPersons,
  createRelationship,
  deleteRelationship,
  generateBiography,
  saveBiography,
  unverifyBiography,
  type PersonWithCount,
  type PersonRelationship,
  type LetterForEntity,
  type SameNamePersonCandidate,
  type EntityMatch,
  type CanonicalPerson,
} from "../../api/entities";
import MergeComparison from "../../components/MergeComparison";
import BulkMergeModal from "../../components/BulkMergeModal";
import { PERSON_RELATIONSHIP_OPTIONS } from "../../constants/enums";
import type { PersonRelationshipType } from "../../types/Letter";
import EntityListPanel from "./EntityManagement/EntityListPanel";
import SameNameCandidatesCard from "./EntityManagement/SameNameCandidatesCard";
import {
  filterEntitiesBySearch,
  getCanonicalNameConflicts,
  parseAliasInput,
  toggleSelectedId,
} from "./EntityManagement/entity-utils";
import "./PeoplePage.css";

export default function PeoplePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  // Main state
  const [persons, setPersons] = useState<PersonWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [deepLinkedEntityId, setDeepLinkedEntityId] = useState<string | null>(null);

  // Selected person for detail view
  const [selectedPerson, setSelectedPerson] = useState<PersonWithCount | null>(null);
  const [selectedRelationships, setSelectedRelationships] = useState<PersonRelationship[]>([]);
  const [selectedLetters, setSelectedLetters] = useState<LetterForEntity[]>([]);
  const [sameNameCandidates, setSameNameCandidates] = useState<SameNamePersonCandidate[]>([]);
  const [loadingRelationships, setLoadingRelationships] = useState(false);

  // Biography state
  const [biographyText, setBiographyText] = useState("");
  const [biographyStatus, setBiographyStatus] = useState<string | undefined>(undefined);
  const [generatingBiography, setGeneratingBiography] = useState(false);
  const [savingBiography, setSavingBiography] = useState(false);

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
  const [showAddRelationshipModal, setShowAddRelationshipModal] = useState(false);
  const [lastUndoAction, setLastUndoAction] = useState<{
    actionId: string;
    actionType: "rename" | "merge";
    label: string;
  } | null>(null);
  const [undoingAction, setUndoingAction] = useState(false);

  // Refresh trigger for suggestions
  const [refreshKey, setRefreshKey] = useState(0);

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
    if (!isAuthenticated()) {
      navigate("/admin-login");
    }
  }, [navigate]);

  // Fetch persons
  const fetchPersons = useCallback(async () => {
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
  }, [showToast]);

  useEffect(() => {
    fetchPersons();
  }, [fetchPersons]);

  const deepLinkedPersonId = searchParams.get("personId");

  useEffect(() => {
    if (!deepLinkedPersonId || persons.length === 0) return;

    const matched = persons.find((person) => person.id === deepLinkedPersonId);
    if (matched) {
      setSelectedPerson(matched);
      setDeepLinkedEntityId(matched.id);
      showToast(`Opened ${matched.canonicalName}`, "info");
    } else {
      showToast("Linked person was not found", "error");
    }

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("personId");
        return next;
      },
      { replace: true },
    );
  }, [deepLinkedPersonId, persons, setSearchParams, showToast]);

  const openCandidatePerson = useCallback(async (personId: string) => {
    const inMemoryMatch = persons.find((person) => person.id === personId);
    if (inMemoryMatch) {
      setSelectedPerson(inMemoryMatch);
      setDeepLinkedEntityId(null);
      return;
    }

    try {
      const response = await getAllPersons();
      setPersons(response.persons);
      const refreshedMatch = response.persons.find((person) => person.id === personId);
      if (refreshedMatch) {
        setSelectedPerson(refreshedMatch);
        setDeepLinkedEntityId(null);
      } else {
        showToast("Candidate profile is no longer available", "info");
      }
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to open candidate profile"), "error");
    }
  }, [persons, showToast]);

  const fetchSelectedPersonDetails = useCallback(async (personId: string) => {
    setLoadingRelationships(true);
    try {
      const [response, sameNameResponse] = await Promise.all([
        getPersonById(personId),
        getPersonSameNameCandidates(personId),
      ]);
      setSelectedRelationships(response.relationships || []);
      setSelectedLetters(response.letters || []);
      setSameNameCandidates(sameNameResponse.candidates || []);
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to load person details"), "error");
    } finally {
      setLoadingRelationships(false);
    }
  }, [showToast]);

  // Fetch relationships + references when person is selected
  useEffect(() => {
    if (!selectedPerson) {
      setSelectedRelationships([]);
      setSelectedLetters([]);
      setSameNameCandidates([]);
      return;
    }
    fetchSelectedPersonDetails(selectedPerson.id);
  }, [selectedPerson, fetchSelectedPersonDetails]);

  // Update biography state when person is selected
  useEffect(() => {
    if (selectedPerson) {
      setBiographyText((selectedPerson as unknown as CanonicalPerson).biography || "");
      setBiographyStatus((selectedPerson as unknown as CanonicalPerson).biographyStatus);
    } else {
      setBiographyText("");
      setBiographyStatus(undefined);
    }
  }, [selectedPerson]);

  // Filtered persons
  const filteredPersons = useMemo(() => {
    return filterEntitiesBySearch(persons, searchQuery);
  }, [persons, searchQuery]);

  // Handle create
  const handleCreate = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const aliases = parseAliasInput(formAliases);
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

    const nextCanonicalName = formName.trim();
    const nameChanged = nextCanonicalName !== selectedPerson.canonicalName;
    if (nameChanged) {
      const conflicts = getCanonicalNameConflicts(persons, selectedPerson.id, nextCanonicalName);
      if (conflicts.length > 0) {
        const proceed = confirm(
          `${conflicts.length} other person profile(s) already use "${nextCanonicalName}". Continue with rename anyway?`,
        );
        if (!proceed) return;
      }
    }

    setSaving(true);
    try {
      const aliases = parseAliasInput(formAliases);
      const updateResponse = await updatePerson(selectedPerson.id, {
        canonicalName: nextCanonicalName,
        aliases,
        notes: formNotes.trim() || null,
      });
      if (updateResponse.undoActionId) {
        setLastUndoAction({
          actionId: updateResponse.undoActionId,
          actionType: "rename",
          label: `Rename: ${selectedPerson.canonicalName} -> ${nextCanonicalName}`,
        });
      }
      showToast("Person updated", "success");
      setShowEditModal(false);
      // Refresh list
      const refreshedList = await getAllPersons();
      setPersons(refreshedList.persons);
      // Update selected person
      const updated = refreshedList.persons.find((p) => p.id === selectedPerson.id);
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
      const mergeResponse = await mergePersons(selectedPerson.id, mergeTargetId);
      if (mergeResponse.undoActionId) {
        setLastUndoAction({
          actionId: mergeResponse.undoActionId,
          actionType: "merge",
          label: `Merge into ${selectedPerson.canonicalName}`,
        });
      }
      showToast("Persons merged", "success");
      setShowMergeModal(false);
      setMergeTargetId(null);
      setMergeSearchQuery("");
      setMergeSearchResults([]);
      // Refresh list
      const refreshedList = await getAllPersons();
      setPersons(refreshedList.persons);
      // Update selected person
      const updated = refreshedList.persons.find((p) => p.id === selectedPerson.id);
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
      await fetchSelectedPersonDetails(selectedPerson.id);
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
      if (selectedPerson) {
        await fetchSelectedPersonDetails(selectedPerson.id);
      }
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to remove relationship"), "error");
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

  const getRelatedPersonId = (relationship: PersonRelationship) => {
    if (!selectedPerson) return null;
    return relationship.personAId === selectedPerson.id
      ? relationship.personBId
      : relationship.personAId;
  };

  const handleOpenRelatedPerson = (relationship: PersonRelationship) => {
    const relatedId = getRelatedPersonId(relationship);
    if (!relatedId) return;

    const related = persons.find((person) => person.id === relatedId);
    if (related) {
      setSelectedPerson(related);
      setDeepLinkedEntityId(related.id);
      return;
    }

    navigate(`/admin/entities/people?personId=${relatedId}`);
  };

  const formatReferenceRole = (role: string) => {
    return role.replace(/_/g, " ");
  };

  // Handle generate biography
  const handleGenerateBiography = async () => {
    if (!selectedPerson) return;
    setGeneratingBiography(true);
    try {
      const response = await generateBiography(selectedPerson.id);
      setBiographyText(response.person.biography || "");
      setBiographyStatus(response.person.biographyStatus);
      showToast("Biography generated", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to generate biography",
        "error"
      );
    } finally {
      setGeneratingBiography(false);
    }
  };

  // Handle save biography
  const handleSaveBiography = async (verify = false) => {
    if (!selectedPerson) return;
    setSavingBiography(true);
    try {
      const response = await saveBiography(selectedPerson.id, {
        biography: biographyText,
        verify,
      });
      setBiographyStatus(response.person.biographyStatus);
      showToast(verify ? "Biography verified" : "Biography saved", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save biography",
        "error"
      );
    } finally {
      setSavingBiography(false);
    }
  };

  // Handle unverify biography
  const handleUnverifyBiography = async () => {
    if (!selectedPerson) return;
    try {
      const response = await unverifyBiography(selectedPerson.id);
      setBiographyStatus(response.person.biographyStatus);
      showToast("Biography unverified", "success");
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to unverify biography"), "error");
    }
  };

  // Bulk selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => toggleSelectedId(prev, id));
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredPersons.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPersons.map((p) => p.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // Handle bulk merge
  const handleBulkMerge = async (keepId: string, mergeIds: string[]) => {
    setBulkMerging(true);
    try {
      await bulkMergePersons(keepId, mergeIds);
      showToast(`${mergeIds.length} persons merged successfully`, "success");
      setShowBulkMergeModal(false);
      setSelectedIds(new Set());
      await fetchPersons();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to merge persons",
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
      const response = await mergePersons(keepId, mergeId);
      if (response.undoActionId) {
        const kept = persons.find((person) => person.id === keepId);
        setLastUndoAction({
          actionId: response.undoActionId,
          actionType: "merge",
          label: `Merge into ${kept?.canonicalName || "selected person"}`,
        });
      }
      showToast("Persons merged successfully", "success");
      setShowMergeComparison(false);
      setMergeCompareA(null);
      setMergeCompareB(null);
      await fetchPersons();
      setRefreshKey((k) => k + 1);
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to merge persons",
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleUndoLastAction = async () => {
    if (!lastUndoAction) return;
    setUndoingAction(true);
    try {
      await undoPersonAction(lastUndoAction.actionId, lastUndoAction.actionType);
      showToast("Person action undone", "success");
      setLastUndoAction(null);
      const response = await getAllPersons();
      setPersons(response.persons);
      if (selectedPerson) {
        const refreshedSelected = response.persons.find((p) => p.id === selectedPerson.id);
        setSelectedPerson(refreshedSelected || null);
      }
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to undo action",
        "error",
      );
    } finally {
      setUndoingAction(false);
    }
  };

  // Get selected entities for bulk merge modal
  const selectedEntities = useMemo(() => {
    return filteredPersons
      .filter((p) => selectedIds.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.canonicalName,
        letterCount: p.letterCount,
        aliases: p.aliases || [],
      }));
  }, [filteredPersons, selectedIds]);

  return (
    <div className="people-page">
      <div className="page-actions">
        <Button onClick={() => setShowCreateModal(true)}>Add Person</Button>
      </div>

      {lastUndoAction && (
        <div className="undo-banner">
          <span className="undo-banner-label">Last action: {lastUndoAction.label}</span>
          <div className="undo-banner-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleUndoLastAction}
              disabled={undoingAction}
            >
              {undoingAction ? "Undoing..." : "Undo"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLastUndoAction(null)}
              disabled={undoingAction}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="page-content">
        {/* Left: People List */}
        <EntityListPanel
          entityType="person"
          refreshKey={refreshKey}
          onSuggestionMerge={handleSuggestionMerge}
          onRefreshSuggestions={() => setRefreshKey((k) => k + 1)}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchPlaceholder="Search people..."
          items={filteredPersons}
          loading={loading}
          emptyMessage="No people found"
          selectedEntityId={selectedPerson?.id ?? null}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectItem={(person) => {
            setSelectedPerson(person);
            setDeepLinkedEntityId(null);
          }}
          onSelectAll={handleSelectAll}
          onOpenBulkMerge={() => setShowBulkMergeModal(true)}
          onClearSelection={handleClearSelection}
          panelClassName="people-list-panel"
          listClassName="people-list"
          itemClassName="person-item"
          contentClassName="person-content"
          renderItemContent={(person) => (
            <>
              <div className="person-name">{person.canonicalName}</div>
              <div className="person-meta">
                {person.letterCount} letter{person.letterCount !== 1 && "s"}
                {person.aliases && person.aliases.length > 0 && (
                  <span className="aliases-indicator">
                    +{person.aliases.length} alias{person.aliases.length !== 1 && "es"}
                  </span>
                )}
              </div>
            </>
          )}
        />

        {/* Right: Person Detail */}
        <div className="person-detail-panel">
          {selectedPerson ? (
            <>
              <div className="detail-header">
                {deepLinkedEntityId === selectedPerson.id && (
                  <div className="jump-context-banner">Opened from linked entity</div>
                )}
                <div className="detail-header-row">
                  <h2>{selectedPerson.canonicalName}</h2>
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
                <div className="detail-stat-row">
                  <span className="detail-stat">
                    <span className="detail-stat-value">{selectedPerson.letterCount}</span>
                    <span className="detail-stat-label">letter{selectedPerson.letterCount !== 1 ? "s" : ""}</span>
                  </span>
                  {selectedPerson.aliases && selectedPerson.aliases.length > 0 && (
                    <span className="detail-stat">
                      <span className="detail-stat-value">{selectedPerson.aliases.length}</span>
                      <span className="detail-stat-label">alias{selectedPerson.aliases.length !== 1 ? "es" : ""}</span>
                    </span>
                  )}
                  {selectedRelationships.length > 0 && (
                    <span className="detail-stat">
                      <span className="detail-stat-value">{selectedRelationships.length}</span>
                      <span className="detail-stat-label">relationship{selectedRelationships.length !== 1 ? "s" : ""}</span>
                    </span>
                  )}
                </div>
              </div>

              {selectedPerson.aliases && selectedPerson.aliases.length > 0 && (
                <div className="detail-card">
                  <h4>Aliases</h4>
                  <div className="alias-chips">
                    {selectedPerson.aliases.map((alias, i) => (
                      <span key={i} className="alias-chip">{alias}</span>
                    ))}
                  </div>
                </div>
              )}

              {selectedPerson.notes && (
                <div className="detail-card">
                  <h4>Notes</h4>
                  <p className="detail-notes">{selectedPerson.notes}</p>
                </div>
              )}

              <SameNameCandidatesCard
                title="Same-Name Candidates"
                note="This name exists on other profiles. Review before merging or bulk renaming references."
                candidates={sameNameCandidates}
                renderMeta={(candidate) =>
                  `${candidate.letterCount} letters${candidate.aliases.length > 0 ? ` · ${candidate.aliases.length} aliases` : ""}`
                }
                onSelect={openCandidatePerson}
              />

              <div className="detail-card">
                <div className="section-header">
                  <h4>Letter References</h4>
                </div>
                {loadingRelationships ? (
                  <div className="loading-state">Loading references...</div>
                ) : selectedLetters.length === 0 ? (
                  <div className="empty-state-inline">No linked letters yet</div>
                ) : (
                  <div className="reference-list">
                    {selectedLetters.map((letter) => (
                      <button
                        key={`${letter.letterId}-${letter.role}`}
                        type="button"
                        className="reference-item"
                        onClick={() => navigate(`/admin/letters/${letter.letterId}`)}
                      >
                        <div className="reference-header">
                          <span className="reference-date">
                            {letter.letterDate || letter.dateRaw}
                          </span>
                          <span className={`reference-role-badge role-${letter.role}`}>{formatReferenceRole(letter.role)}</span>
                        </div>
                        {(letter.hook || letter.summary || letter.context) && (
                          <div className="reference-preview">
                            {letter.hook || letter.summary || letter.context}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="detail-card biography-section">
                <div className="section-header">
                  <h4>Biography</h4>
                  <div className="biography-actions">
                    {biographyStatus === "VERIFIED" ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleUnverifyBiography}
                      >
                        Unverify
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleGenerateBiography}
                          disabled={generatingBiography}
                        >
                          {generatingBiography ? "Generating..." : "Generate"}
                        </Button>
                        {biographyText && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSaveBiography(false)}
                              disabled={savingBiography}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSaveBiography(true)}
                              disabled={savingBiography}
                            >
                              Verify
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {biographyStatus && (
                  <div className={`biography-status status-${biographyStatus.toLowerCase()}`}>
                    {biographyStatus.replace("_", " ")}
                  </div>
                )}
                <textarea
                  className="biography-editor"
                  value={biographyText}
                  onChange={(e) => setBiographyText(e.target.value)}
                  placeholder="No biography yet. Click 'Generate' to create one from letter summaries."
                  rows={8}
                  disabled={biographyStatus === "VERIFIED"}
                />
              </div>

              <div className="detail-card">
                <div className="section-header">
                  <h4>Relationships</h4>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowAddRelationshipModal(true)}
                  >
                    Add
                  </Button>
                </div>
                {loadingRelationships ? (
                  <div className="loading-state">Loading...</div>
                ) : selectedRelationships.length === 0 ? (
                  <div className="empty-state-inline">No relationships yet</div>
                ) : (
                  <div className="relationships-list">
                    {selectedRelationships.map((rel) => (
                      <div key={rel.id} className="relationship-item">
                        <div className="relationship-info">
                          <span className="relationship-type">
                            {PERSON_RELATIONSHIP_OPTIONS.find((t) => t.value === rel.relationshipType)?.label ||
                              rel.relationshipType}
                          </span>
                          <button
                            type="button"
                            className="relationship-person-btn"
                            onClick={() => handleOpenRelatedPerson(rel)}
                          >
                            {getRelatedPersonName(rel)}
                          </button>
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
              <Icon name="person" size={48} />
              <p>Select a person to view details</p>
              <span className="no-selection-hint">Choose from the list or search by name</span>
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
              {PERSON_RELATIONSHIP_OPTIONS.map((type) => (
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

      {/* Merge Comparison Modal */}
      {mergeCompareA && mergeCompareB && (
        <MergeComparison
          isOpen={showMergeComparison}
          onClose={() => {
            setShowMergeComparison(false);
            setMergeCompareA(null);
            setMergeCompareB(null);
          }}
          entityType="person"
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
        entityType="person"
        selectedEntities={selectedEntities}
        onConfirm={handleBulkMerge}
        loading={bulkMerging}
      />
    </div>
  );
}
