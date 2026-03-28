import type { FilterSuggestion } from "./searchBarUtils";

export default function SuggestionHint({ suggestion }: { suggestion: FilterSuggestion | null }) {
  if (!suggestion) return null;

  return (
    <p className="filter-suggestion-hint">
      Press Enter to use <strong>{suggestion.display}</strong>
      <span> · {suggestion.count} item{suggestion.count === 1 ? "" : "s"}</span>
    </p>
  );
}
