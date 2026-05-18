import type { ChangeEvent } from "react";

interface RowSelectionCheckboxCellProps {
  label: string;
  checked: boolean;
  onChange: (options: { shiftKey: boolean }) => void;
}

export default function RowSelectionCheckboxCell({
  label,
  checked,
  onChange,
}: RowSelectionCheckboxCellProps) {
  return (
    <td
      className="checkbox-cell"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <input
        type="checkbox"
        className="row-checkbox"
        aria-label={label}
        checked={checked}
        onClick={(event) => {
          event.stopPropagation();
        }}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          event.stopPropagation();
          const nativeEvent = event.nativeEvent;
          onChange({
            shiftKey: "shiftKey" in nativeEvent ? Boolean(nativeEvent.shiftKey) : false,
          });
        }}
      />
    </td>
  );
}
