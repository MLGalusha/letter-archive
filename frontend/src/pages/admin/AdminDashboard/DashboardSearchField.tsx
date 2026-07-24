import Icon from "../../../components/common/Icon";
import { MAX_DASHBOARD_SEARCH_LENGTH } from "./constants";

interface DashboardSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

export default function DashboardSearchField({
  value,
  onChange,
  onClear,
}: DashboardSearchFieldProps) {
  return (
    <div className="dashboard-search-field">
      <input
        type="search"
        placeholder="Search letters, senders, recipients..."
        value={value}
        maxLength={MAX_DASHBOARD_SEARCH_LENGTH}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="dashboard-search-clear"
          onClick={onClear}
          aria-label="Clear search"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
