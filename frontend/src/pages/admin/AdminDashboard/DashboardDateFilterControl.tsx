import { DAY_OPTIONS, MONTH_OPTIONS, YEAR_OPTIONS } from "./constants";
import type { DateMode } from "./types";

interface DashboardDateFilterControlProps {
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
    <section className={`filter-panel-section date-filter-section ${hasDateFilter ? "date-filter-section--active" : ""}`}>
      <div className="filter-panel-section-header">
        <div>
          <span className="filter-panel-label">Date</span>
          <span className="filter-panel-summary">{hasDateFilter ? getDateButtonText() : "Any date"}</span>
        </div>
        {hasDateFilter && (
          <button type="button" className="filter-panel-clear" onClick={clearDateFilters}>
            Clear
          </button>
        )}
      </div>

      <div className="date-mode-toggle" role="group" aria-label="Date filter mode">
        <button
          type="button"
          className={`mode-btn ${dateMode === "specific" ? "active" : ""}`}
          aria-pressed={dateMode === "specific"}
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
          aria-pressed={dateMode === "range"}
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
          <select
            aria-label="Date year"
            value={yearFilter ?? ""}
            onChange={(event) => setYearFilter(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Year</option>
            {YEAR_OPTIONS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <select
            aria-label="Date month"
            value={monthFilter ?? ""}
            onChange={(event) => setMonthFilter(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Month</option>
            {MONTH_OPTIONS.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
          </select>
          <select
            aria-label="Date day"
            value={dayFilter ?? ""}
            onChange={(event) => setDayFilter(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Day</option>
            {DAY_OPTIONS.map((day) => <option key={day} value={day}>{day}</option>)}
          </select>
        </div>
      ) : (
        <div className="date-range-inputs">
          <label className="date-range-field">
            <span>From</span>
            <input
              type="text"
              placeholder="mm/dd/yyyy"
              value={dateFromFilter ? dateRawToDisplay(dateFromFilter) : ""}
              onChange={(event) => setDateFromFilter(displayToDateRaw(event.target.value))}
              maxLength={10}
            />
          </label>
          <label className="date-range-field">
            <span>To</span>
            <input
              type="text"
              placeholder="mm/dd/yyyy"
              value={dateToFilter ? dateRawToDisplay(dateToFilter) : ""}
              onChange={(event) => setDateToFilter(displayToDateRaw(event.target.value))}
              maxLength={10}
            />
          </label>
        </div>
      )}
    </section>
  );
}
