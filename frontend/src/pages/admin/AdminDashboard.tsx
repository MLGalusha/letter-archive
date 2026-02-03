import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getAdminLetters, type SortField, type SortOrder } from "../../api/letters";
import type { Letter, WorkflowState, VisibilityState } from "../../types/Letter";
import "./AdminDashboard.css";

const WORKFLOW_LABELS: Record<WorkflowState, string> = {
  UPLOADED: "Uploaded",
  TRANSCRIBING: "Transcribing",
  TRANSCRIBED: "Transcribed",
  METADATA_EXTRACTING: "Extracting",
  METADATA_DRAFTED: "Metadata Ready",
  REVIEWED: "Reviewed",
};

const VISIBILITY_LABELS: Record<VisibilityState, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  HIDDEN: "Hidden",
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [visibilityFilter, setVisibilityFilter] = useState<"all" | VisibilityState>("all");
  const [workflowFilter, setWorkflowFilter] = useState<"all" | WorkflowState>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Sorting
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const fetchLetters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAdminLetters({
        limit: 100,
        visibility: visibilityFilter === "all" ? undefined : visibilityFilter,
        workflow: workflowFilter === "all" ? undefined : workflowFilter,
        sort: sortField,
        sortOrder: sortOrder,
      });
      setLetters(response.letters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load letters");
      console.error("Failed to fetch letters:", err);
    } finally {
      setLoading(false);
    }
  }, [visibilityFilter, workflowFilter, sortField, sortOrder]);

  useEffect(() => {
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
      return;
    }
    fetchLetters();
  }, [navigate, fetchLetters]);

  const handleLogout = () => {
    sessionStorage.removeItem("adminAuth");
    navigate("/admin-login");
  };

  const handleRowClick = (letterId: string) => {
    navigate(`/admin/letters/${letterId}`);
  };

  const handleUploadClick = () => {
    navigate("/admin/upload");
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortOrder === "asc" ? " \u2191" : " \u2193";
  };

  // Client-side search filtering
  const filteredLetters = letters.filter((letter) => {
    if (searchQuery === "") return true;
    const query = searchQuery.toLowerCase();
    return (
      letter.metadata.sender?.toLowerCase().includes(query) ||
      letter.metadata.recipient?.toLowerCase().includes(query) ||
      letter.title.toLowerCase().includes(query)
    );
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getWorkflowBadge = (workflow: WorkflowState) => {
    return (
      <span className={`badge badge-workflow badge-workflow-${workflow.toLowerCase()}`}>
        {WORKFLOW_LABELS[workflow]}
      </span>
    );
  };

  const getVisibilityBadge = (visibility: VisibilityState) => {
    if (visibility === "DRAFT") return null;
    return (
      <span className={`badge badge-visibility badge-${visibility.toLowerCase()}`}>
        {VISIBILITY_LABELS[visibility]}
      </span>
    );
  };

  // Stats calculations
  const stats = {
    total: letters.length,
    uploaded: letters.filter((l) => l.workflowState === "UPLOADED").length,
    transcribed: letters.filter((l) => l.workflowState === "TRANSCRIBED" || l.workflowState === "METADATA_DRAFTED").length,
    reviewed: letters.filter((l) => l.workflowState === "REVIEWED").length,
    published: letters.filter((l) => l.visibility === "PUBLISHED").length,
  };

  if (loading) {
    return (
      <div className="admin-dashboard">
        <header className="admin-header">
          <h1>Admin Panel</h1>
        </header>
        <div className="admin-content">
          <p>Loading letters...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-dashboard">
        <header className="admin-header">
          <h1>Admin Panel</h1>
        </header>
        <div className="admin-content">
          <p className="error-message">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <h1>Admin Panel</h1>
        <button onClick={handleLogout} className="logout-button">
          Logout
        </button>
      </header>

      <div className="admin-content">
        <div className="admin-toolbar">
          <button onClick={handleUploadClick} className="upload-button">
            Upload New Letter
          </button>

          <div className="filter-search-container">
            <div className="filter-group">
              <label>Visibility:</label>
              <select
                value={visibilityFilter}
                onChange={(e) => setVisibilityFilter(e.target.value as typeof visibilityFilter)}
              >
                <option value="all">All</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="HIDDEN">Hidden</option>
              </select>
            </div>

            <div className="filter-group">
              <label>Workflow:</label>
              <select
                value={workflowFilter}
                onChange={(e) => setWorkflowFilter(e.target.value as typeof workflowFilter)}
              >
                <option value="all">All</option>
                <option value="UPLOADED">Uploaded</option>
                <option value="TRANSCRIBED">Transcribed</option>
                <option value="METADATA_DRAFTED">Metadata Ready</option>
                <option value="REVIEWED">Reviewed</option>
              </select>
            </div>

            <div className="search-group">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="letters-table-container">
          <table className="letters-table">
            <thead>
              <tr>
                <th
                  className="sortable-header"
                  onClick={() => handleSort("title")}
                >
                  Title{getSortIndicator("title")}
                </th>
                <th
                  className="sortable-header"
                  onClick={() => handleSort("sender")}
                >
                  Sender{getSortIndicator("sender")}
                </th>
                <th>Recipient</th>
                <th
                  className="sortable-header"
                  onClick={() => handleSort("letterDate")}
                >
                  Date{getSortIndicator("letterDate")}
                </th>
                <th>Status</th>
                <th
                  className="sortable-header"
                  onClick={() => handleSort("createdAt")}
                >
                  Created{getSortIndicator("createdAt")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredLetters.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No letters found
                  </td>
                </tr>
              ) : (
                filteredLetters.map((letter) => (
                  <tr
                    key={letter.id}
                    onClick={() => handleRowClick(letter.id)}
                    className="letter-row"
                  >
                    <td>{letter.title}</td>
                    <td>{letter.metadata.sender || "—"}</td>
                    <td>{letter.metadata.recipient || "—"}</td>
                    <td>{letter.metadata.date || "—"}</td>
                    <td>
                      <div className="status-badges">
                        {getWorkflowBadge(letter.workflowState)}
                        {getVisibilityBadge(letter.visibility)}
                      </div>
                    </td>
                    <td>{formatDate(letter.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Uploaded</div>
            <div className="stat-value">{stats.uploaded}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ready for Review</div>
            <div className="stat-value">{stats.transcribed}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Reviewed</div>
            <div className="stat-value">{stats.reviewed}</div>
          </div>
          <div className="stat-card stat-card-highlight">
            <div className="stat-label">Published</div>
            <div className="stat-value">{stats.published}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
