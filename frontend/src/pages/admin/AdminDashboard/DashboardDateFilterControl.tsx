import { DAY_OPTIONS, MONTH_OPTIONS, YEAR_OPTIONS } from "./constants";
import type { DashboardDateFilterValue } from "./dashboardFilterStateModel";
import { dateRawToDisplay, displayToDateRaw } from "./utils";
import type { DateMode } from "./types";

interface DashboardDateFilterControlProps {
  value: DashboardDateFilterValue;
  summary: string;
  onModeChange: (value: DateMode) => void;
  onYearChange: (value: number | null) => void;
  onMonthChange: (value: number | null) => void;
  onDayChange: (value: number | null) => void;
  onDateFromChange: (value: string | null) => void;
  onDateToChange: (value: string | null) => void;
  onClear: () => void;
}

export default function DashboardDateFilterControl({
  value,
  summary,
  onModeChange,
  onYearChange,
  onMonthChange,
  onDayChange,
  onDateFromChange,
  onDateToChange,
  onClear,
}: DashboardDateFilterControlProps) {
  const {
    dateMode,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
  } = value;
  const hasDateFilter = yearFilter !== null
    || monthFilter !== null
    || dayFilter !== null
    || dateFromFilter !== null
    || dateToFilter !== null;

  return (
    <section className={`filter-panel-section date-filter-section ${hasDateFilter ? "date-filter-section--active" : ""}`}>
      <div className="filter-panel-section-header">
        <div>
          <span className="filter-panel-label">Date</span>
          <span className="filter-panel-summary">{hasDateFilter ? summary : "Any date"}</span>
        </div>
        {hasDateFilter && (
          <button type="button" className="filter-panel-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      <div className="date-mode-toggle" role="group" aria-label="Date filter mode">
        <button
          type="button"
          className={`mode-btn ${dateMode === "specific" ? "active" : ""}`}
          aria-pressed={dateMode === "specific"}
          onClick={() => onModeChange("specific")}
        >
          Specific
        </button>
        <button
          type="button"
          className={`mode-btn ${dateMode === "range" ? "active" : ""}`}
          aria-pressed={dateMode === "range"}
          onClick={() => onModeChange("range")}
        >
          Range
        </button>
      </div>

      {dateMode === "specific" ? (
        <div className="date-dropdowns">
          <label className="date-select-field">
            <span>Year</span>
            <select
              aria-label="Date year"
              value={yearFilter ?? ""}
              onChange={(event) => onYearChange(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Any</option>
              {YEAR_OPTIONS.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="date-select-field">
            <span>Month</span>
            <select
              aria-label="Date month"
              value={monthFilter ?? ""}
              onChange={(event) => onMonthChange(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Any</option>
              {MONTH_OPTIONS.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}
            </select>
          </label>
          <label className="date-select-field">
            <span>Day</span>
            <select
              aria-label="Date day"
              value={dayFilter ?? ""}
              onChange={(event) => onDayChange(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Any</option>
              {DAY_OPTIONS.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="date-range-inputs">
          <label className="date-range-field">
            <span>From</span>
            <input
              type="text"
              placeholder="mm/dd/yyyy"
              value={dateFromFilter ? dateRawToDisplay(dateFromFilter) : ""}
              onChange={(event) => onDateFromChange(displayToDateRaw(event.target.value))}
              maxLength={10}
            />
          </label>
          <label className="date-range-field">
            <span>To</span>
            <input
              type="text"
              placeholder="mm/dd/yyyy"
              value={dateToFilter ? dateRawToDisplay(dateToFilter) : ""}
              onChange={(event) => onDateToChange(displayToDateRaw(event.target.value))}
              maxLength={10}
            />
          </label>
        </div>
      )}
    </section>
  );
}
