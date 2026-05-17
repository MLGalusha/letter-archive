import type { RefObject } from "react";
import Icon from "../../../components/common/Icon";
import { DAY_OPTIONS, MONTH_OPTIONS, YEAR_OPTIONS } from "./constants";
import type { DateMode } from "./types";

interface DashboardDateFilterControlProps {
  showDateDropdown: boolean;
  setShowDateDropdown: (value: boolean) => void;
  dateDropdownRef: RefObject<HTMLDivElement | null>;
  dateMode: DateMode;
  setDateMode: (value: DateMode) => void;
  hasDateFilter: boolean;
  yearFilter: number | null;
  setYearFilter: (value: number | null) => void;
  monthFilter: number | null;
  setMonthFilter: (value: number | null) => void;
  dayFilter: number | null;
  setDayFilter: (value: number | null) => void;
  dateFromFilter: string | null;
  setDateFromFilter: (value: string | null) => void;
  dateToFilter: string | null;
  setDateToFilter: (value: string | null) => void;
  clearDateFilters: () => void;
  getDateButtonText: () => string;
  dateRawToDisplay: (dateRaw: string | null) => string;
  displayToDateRaw: (display: string) => string | null;
}

export default function DashboardDateFilterControl({
  showDateDropdown,
  setShowDateDropdown,
  dateDropdownRef,
  dateMode,
  setDateMode,
  hasDateFilter,
  yearFilter,
  setYearFilter,
  monthFilter,
  setMonthFilter,
  dayFilter,
  setDayFilter,
  dateFromFilter,
  setDateFromFilter,
  dateToFilter,
  setDateToFilter,
  clearDateFilters,
  getDateButtonText,
  dateRawToDisplay,
  displayToDateRaw,
}: DashboardDateFilterControlProps) {
  return (
    <div className="dropdown-container" ref={dateDropdownRef}>
      <button
        type="button"
        className={`dropdown-trigger ${hasDateFilter ? "active" : ""}`}
        onClick={() => setShowDateDropdown(!showDateDropdown)}
      >
        {getDateButtonText()} <Icon name="chevron-down" size={12} />
      </button>
      {showDateDropdown && (
        <div className="date-dropdown-panel">
          <div className="date-mode-toggle">
            <button
              type="button"
              className={`mode-btn ${dateMode === "specific" ? "active" : ""}`}
              onClick={() => {
                setDateMode("specific");
                setDateFromFilter(null);
                setDateToFilter(null);
              }}
            >
              Specific
            </button>
            <button
              type="button"
              className={`mode-btn ${dateMode === "range" ? "active" : ""}`}
              onClick={() => {
                setDateMode("range");
                setYearFilter(null);
                setMonthFilter(null);
                setDayFilter(null);
              }}
            >
              Range
            </button>
          </div>

          {dateMode === "specific" ? (
            <div className="date-dropdowns">
              <select value={yearFilter ?? ""} onChange={(event) => setYearFilter(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Year</option>
                {YEAR_OPTIONS.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
              <select value={monthFilter ?? ""} onChange={(event) => setMonthFilter(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Month</option>
                {MONTH_OPTIONS.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
              </select>
              <select value={dayFilter ?? ""} onChange={(event) => setDayFilter(event.target.value ? Number(event.target.value) : null)}>
                <option value="">Day</option>
                {DAY_OPTIONS.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </div>
          ) : (
            <div className="date-range-inputs">
              <div className="date-range-field">
                <label>From</label>
                <input
                  type="text"
                  placeholder="mm/dd/yyyy"
                  value={dateFromFilter ? dateRawToDisplay(dateFromFilter) : ""}
                  onChange={(event) => setDateFromFilter(displayToDateRaw(event.target.value))}
                  maxLength={10}
                />
              </div>
              <div className="date-range-field">
                <label>To</label>
                <input
                  type="text"
                  placeholder="mm/dd/yyyy"
                  value={dateToFilter ? dateRawToDisplay(dateToFilter) : ""}
                  onChange={(event) => setDateToFilter(displayToDateRaw(event.target.value))}
                  maxLength={10}
                />
              </div>
            </div>
          )}

          {hasDateFilter && (
            <button type="button" className="date-clear-btn" onClick={clearDateFilters}>
              Clear Date
            </button>
          )}
        </div>
      )}
    </div>
  );
}
