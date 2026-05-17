import type { DashboardView } from "./types";

interface DashboardViewToggleProps {
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
}

export default function DashboardViewToggle({
  dashboardView,
  onDashboardViewChange,
}: DashboardViewToggleProps) {
  return (
    <div className="dashboard-view-toggle" aria-label="Dashboard view">
      <button
        className={`view-toggle-btn ${dashboardView === "letters" ? "active" : ""}`}
        onClick={() => onDashboardViewChange("letters")}
      >
        Letters
      </button>
      <button
        className={`view-toggle-btn ${dashboardView === "collections" ? "active" : ""}`}
        onClick={() => onDashboardViewChange("collections")}
      >
        Collections
      </button>
    </div>
  );
}
