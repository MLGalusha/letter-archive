import { useState } from "react";
import type { DashboardView } from "./types";

const DASHBOARD_VIEW_STORAGE_KEY = "dashboard-view";

function loadDashboardView(): DashboardView {
  const savedView = localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY);
  return savedView === "collections" ? "collections" : "letters";
}

export function useDashboardViewState() {
  const [dashboardView, setDashboardView] = useState<DashboardView>(loadDashboardView);

  const handleDashboardViewChange = (view: DashboardView) => {
    setDashboardView(view);
    localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, view);
  };

  return {
    dashboardView,
    handleDashboardViewChange,
  };
}
