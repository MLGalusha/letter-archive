import Icon from "../../../components/common/Icon";

interface FilterOptionButtonProps {
  count: number;
  label: string;
  active: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
  onClick: () => void;
}

export default function FilterOptionButton({
  count,
  label,
  active,
  className = "",
  title,
  ariaLabel,
  onClick,
}: FilterOptionButtonProps) {
  return (
    <button
      type="button"
      className={`filter-option ${className} ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      title={title}
      aria-label={ariaLabel}
    >
      <span className="filter-option-state" aria-hidden="true">
        {active && <Icon name="check" size={11} />}
      </span>
      <span className="filter-option-label">{label}</span>
      <span className="filter-option-count">{count}</span>
    </button>
  );
}
