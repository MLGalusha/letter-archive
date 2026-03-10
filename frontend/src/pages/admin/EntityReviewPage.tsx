import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button, Icon } from "../../components/common";
import { useToast } from "../../contexts/ToastContext";
import { getErrorMessage } from "../../api/client";
import {
  getReviewQueue,
  resolveReviewItem,
  searchPersons,
  searchPlaces,
  type EntityReviewItem,
  type ReviewQueueStats,
  type EntityMatch,
} from "../../api/entities";
import "./EntityReviewPage.css";

type FilterType = "all" | "person" | "place";

export default function EntityReviewPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [items, setItems] = useState<EntityReviewItem[]>([]);
  const [stats, setStats] = useState<ReviewQueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Search modal state
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EntityMatch[]>([]);
  const [searchingFor, setSearchingFor] = useState<EntityReviewItem | null>(null);

  // Auth check
  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }
  }, [navigate]);

  // Fetch review queue
  useEffect(() => {
    async function fetchQueue() {
      setLoading(true);
      try {
        const typeFilter = filter === "all" ? undefined : filter;
        const response = await getReviewQueue(typeFilter);
        setItems(response.items);
        setStats(response.stats);
      } catch (err) {
        showToast(getErrorMessage(err, "Failed to load review queue"), "error");
      } finally {
        setLoading(false);
      }
    }
    fetchQueue();
  }, [filter, showToast]);

  // Handle resolve action
  const handleResolve = async (
    item: EntityReviewItem,
    status: "confirmed" | "rejected" | "new_entity"
  ) => {
    setProcessingId(item.id);
    try {
      await resolveReviewItem(item.id, { status, reviewedBy: "admin" });
      // Remove from list
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      // Update stats
      if (stats) {
        const newStats = { ...stats };
        if (item.entityType === "person") {
          newStats.pending.persons--;
        } else {
          newStats.pending.places--;
        }
        if (status === "confirmed") newStats.resolved.confirmed++;
        else if (status === "rejected") newStats.resolved.rejected++;
        else newStats.resolved.newEntity++;
        setStats(newStats);
      }
      showToast(
        status === "confirmed"
          ? "Entity confirmed"
          : status === "rejected"
          ? "Entity rejected"
          : "New entity created",
        "success"
      );
    } catch (err) {
      showToast(getErrorMessage(err, "Failed to resolve"), "error");
    } finally {
      setProcessingId(null);
    }
  };

  // Open search modal for reassignment
  const openSearchModal = (item: EntityReviewItem) => {
    setSearchingFor(item);
    setSearchQuery(item.extractedText);
    setSearchResults([]);
    setSearchModalOpen(true);
  };

  // Search for entities
  const handleSearch = async () => {
    if (!searchQuery.trim() || !searchingFor) return;
    try {
      const response =
        searchingFor.entityType === "person"
          ? await searchPersons(searchQuery)
          : await searchPlaces(searchQuery);
      setSearchResults(response.matches);
    } catch (err) {
      showToast(getErrorMessage(err, "Search failed"), "error");
    }
  };

  // Format confidence as percentage
  const formatConfidence = (confidence: number) => {
    return `${confidence}%`;
  };

  return (
    <div className="entity-review-page">
      <div className="review-content">
        {/* Stats Bar */}
        {stats && (
          <div className="stats-bar">
            <div className="stat">
              <span className="stat-value">
                {stats.pending.persons + stats.pending.places}
              </span>
              <span className="stat-label">Pending</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.pending.persons}</span>
              <span className="stat-label">People</span>
            </div>
            <div className="stat">
              <span className="stat-value">{stats.pending.places}</span>
              <span className="stat-label">Places</span>
            </div>
            <div className="stat stat-success">
              <span className="stat-value">{stats.resolved.confirmed}</span>
              <span className="stat-label">Confirmed</span>
            </div>
            <div className="stat stat-danger">
              <span className="stat-value">{stats.resolved.rejected}</span>
              <span className="stat-label">Rejected</span>
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        <div className="filter-tabs">
          <button
            className={`filter-tab ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All{stats ? ` (${stats.pending.persons + stats.pending.places})` : ""}
          </button>
          <button
            className={`filter-tab ${filter === "person" ? "active" : ""}`}
            onClick={() => setFilter("person")}
          >
            People{stats ? ` (${stats.pending.persons})` : ""}
          </button>
          <button
            className={`filter-tab ${filter === "place" ? "active" : ""}`}
            onClick={() => setFilter("place")}
          >
            Places{stats ? ` (${stats.pending.places})` : ""}
          </button>
        </div>

        {/* Queue Items */}
        {loading ? (
          <div className="loading-state">Loading...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <Icon name="check" size={48} />
            <p>No pending {filter === "person" ? "people" : filter === "place" ? "places" : "items"} to review</p>
          </div>
        ) : (
          <div className="queue-items">
            {items.map((item) => (
              <div key={item.id} className="queue-item">
                <div className="item-header">
                  <span
                    className={`entity-type-badge ${item.entityType}`}
                  >
                    {item.entityType}
                  </span>
                  <span className="extracted-text">"{item.extractedText}"</span>
                  <span className="item-confidence">
                    {formatConfidence(item.confidence)}
                  </span>
                </div>

                {item.context && (
                  <p className="item-context">{item.context}</p>
                )}

                {item.suggestedEntityName && (
                  <div className="suggested-match">
                    <span className="match-label">Suggested match:</span>
                    <span className="match-name">{item.suggestedEntityName}</span>
                  </div>
                )}

                <div className="item-meta">
                  <Link
                    to={`/admin/letters/${item.letterId}`}
                    className="letter-link"
                  >
                    View Letter
                  </Link>
                </div>

                <div className="item-actions">
                  {item.suggestedEntityId && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleResolve(item, "confirmed")}
                      disabled={processingId === item.id}
                    >
                      Confirm Match
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleResolve(item, "new_entity")}
                    disabled={processingId === item.id}
                  >
                    Create New
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openSearchModal(item)}
                    disabled={processingId === item.id}
                  >
                    Search...
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleResolve(item, "rejected")}
                    disabled={processingId === item.id}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search Modal */}
      {searchModalOpen && searchingFor && (
        <div className="modal-overlay" onClick={() => setSearchModalOpen(false)}>
          <div className="search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                Search {searchingFor.entityType === "person" ? "People" : "Places"}
              </h2>
              <button
                className="modal-close"
                onClick={() => setSearchModalOpen(false)}
              >
                <Icon name="close" size={20} />
              </button>
            </div>

            <div className="search-input-row">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name..."
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch}>Search</Button>
            </div>

            <div className="search-results">
              {searchResults.length === 0 ? (
                <p className="no-results">No results found</p>
              ) : (
                searchResults.map((match) => (
                  <div
                    key={match.entityId}
                    className="search-result"
                    onClick={() => {
                      // TODO: Implement reassign to this entity
                      showToast("Reassign not yet implemented", "info");
                      setSearchModalOpen(false);
                    }}
                  >
                    <span className="result-name">{match.canonicalName}</span>
                    <span className="result-similarity">
                      {match.similarity}% match
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
