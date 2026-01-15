import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { mockLetters } from "../../data/mockLetters";
import type { Letter } from "../../types/Letter";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [letters] = useState<Letter[]>(mockLetters);
  const [filter, setFilter] = useState<"all" | "needs_review" | "published" | "hidden">("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // Check if admin is authenticated (mock check)
    const isAuth = sessionStorage.getItem("adminAuth");
    if (!isAuth) {
      navigate("/admin-login");
    }
  }, [navigate]);

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

  // Filter letters based on status and search
  const filteredLetters = letters.filter((letter) => {
    const matchesFilter = filter === "all" || letter.status === filter;
    const matchesSearch =
      searchQuery === "" ||
      letter.metadata.sender?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      letter.metadata.recipient?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      letter.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getStatusBadge = (status: string) => {
    const statusClass = `status-badge status-${status}`;
    return <span className={statusClass}>{status.replace("_", " ")}</span>;
  };

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
              <label>Filter:</label>
              <select value={filter} onChange={(e) => setFilter(e.target.value as any)}>
                <option value="all">All</option>
                <option value="needs_review">Needs Review</option>
                <option value="published">Published</option>
                <option value="hidden">Hidden</option>
              </select>
            </div>

            <div className="search-group">
              <input
                type="text"
                placeholder="Search by sender or recipient..."
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
                <th>ID</th>
                <th>Sender</th>
                <th>Recipient</th>
                <th>Date</th>
                <th>Status</th>
                <th>Created</th>
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
                    <td>{letter.id}</td>
                    <td>{letter.metadata.sender || "—"}</td>
                    <td>{letter.metadata.recipient || "—"}</td>
                    <td>{letter.metadata.date || "—"}</td>
                    <td>{getStatusBadge(letter.status)}</td>
                    <td>{formatDate(letter.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-label">Total Letters</div>
            <div className="stat-value">{letters.length}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Needs Review</div>
            <div className="stat-value">
              {letters.filter((l) => l.status === "needs_review").length}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Published</div>
            <div className="stat-value">
              {letters.filter((l) => l.status === "published").length}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Hidden</div>
            <div className="stat-value">
              {letters.filter((l) => l.status === "hidden").length}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
