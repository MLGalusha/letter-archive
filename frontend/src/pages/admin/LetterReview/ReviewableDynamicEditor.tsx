import {
  useCallback,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { DynamicEditor } from "../../../components/common";
import { useTooltip } from "../../../hooks/useTooltip";

interface ReviewableDynamicEditorProps {
  value: string;
  verified: boolean;
  onChange: (value: string) => void;
  onRequestEdit: () => void;
  placeholder?: string;
}

export function ReviewableDynamicEditor({
  value,
  verified,
  onChange,
  onRequestEdit,
  placeholder,
}: ReviewableDynamicEditorProps) {
  const {
    show,
    position,
    ref: tooltipRef,
    showAt,
    close,
  } = useTooltip();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      document.execCommand("insertText", false, "    ");
    },
    [],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!verified) return;
      showAt(event.clientX, event.clientY);
    },
    [showAt, verified],
  );

  const handleDoubleClick = useCallback(() => {
    if (!verified) return;
    close();
    onRequestEdit();
  }, [close, onRequestEdit, verified]);

  return (
    <div className="extra-content-container">
      <DynamicEditor
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        placeholder={placeholder}
        readOnly={verified}
        verified={verified}
        baseFontSize={1}
        minHeight={180}
      />

      {show && (
        <div
          ref={tooltipRef}
          className="edit-tooltip"
          style={{
            left: Math.min(position.x, window.innerWidth - 280),
            top: position.y + 10,
          }}
        >
          Verified. Double-click to edit and unverify.
        </div>
      )}
    </div>
  );
}
