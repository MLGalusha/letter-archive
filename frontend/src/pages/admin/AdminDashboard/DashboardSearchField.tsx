import Icon from "../../../components/common/Icon";

interface DashboardSearchFieldProps {
  searchInput: string;
  setSearchInput: (value: string) => void;
  setSearchQuery: (value: string) => void;
}

export default function DashboardSearchField({
  searchInput,
  setSearchInput,
  setSearchQuery,
}: DashboardSearchFieldProps) {
  return (
    <div className="dashboard-search-field">
      <input
        type="search"
        placeholder="Search letters, senders, recipients..."
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
      />
      {searchInput && (
        <button
          className="dashboard-search-clear"
          onClick={() => {
            setSearchInput("");
            setSearchQuery("");
          }}
          aria-label="Clear search"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}
