import { memo, useRef, useCallback, useEffect } from "react";

interface SpacingEditorProps {
  /** The reading view text (independent from raw transcript) */
  value: string;
  /** Called when the user modifies spacing */
  onChange: (text: string) => void;
  /** Optional extra class for layout variants */
  className?: string;
}

/**
 * A plain textarea for the reading view. The user can only modify
 * whitespace — word content and order are locked by the edit view.
 */
const dispatchInputEvent = (textarea: HTMLTextAreaElement) => {
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

const replaceSelection = (textarea: HTMLTextAreaElement, nextText: string) => {
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? start;
  textarea.setRangeText(nextText, start, end, "end");
  dispatchInputEvent(textarea);
};

const SpacingEditor = memo(function SpacingEditor({
  value,
  onChange,
  className = "",
}: SpacingEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync value into textarea only when it changes externally
  const lastValueRef = useRef(value);
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (value === lastValueRef.current || ta.value === value) {
      lastValueRef.current = value;
      return;
    }
    const cursor = ta.selectionStart;
    ta.value = value;
    ta.selectionStart = ta.selectionEnd = Math.min(cursor, value.length);
    lastValueRef.current = value;
  }, [value]);

  // Initial setup
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = value;
    }
  }, [value]);

  // ── Input filtering ──────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;

    const allowed = [
      "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
      "Home", "End", "PageUp", "PageDown",
      "Enter", "Backspace", "Delete", " ",
      "Escape",
    ];

    // Tab inserts spaces
    if (e.key === "Tab") {
      e.preventDefault();
      replaceSelection(ta, "    ");
      return;
    }

    // Allow modifier combos for select-all, undo, redo
    if (e.metaKey || e.ctrlKey) {
      if (e.key === "a" || e.key === "z" || e.key === "y") return;
      e.preventDefault();
      return;
    }

    if (e.key === "Shift" || e.key === "Alt" || e.key === "Meta" || e.key === "Control") return;

    if (!allowed.includes(e.key)) {
      e.preventDefault();
      return;
    }

    if (e.key === " " || e.key === "Enter") return;

    // Backspace
    if (e.key === "Backspace") {
      const { selectionStart, selectionEnd, value } = ta;
      if (selectionStart !== selectionEnd) {
        const selected = value.slice(selectionStart!, selectionEnd!);
        if (/\S/.test(selected)) { e.preventDefault(); }
        return;
      }
      if (selectionStart === 0) { e.preventDefault(); return; }
      const ch = value[selectionStart! - 1];
      if (ch !== " " && ch !== "\n") { e.preventDefault(); return; }

      // Newline → select it and replace with space so words don't merge
      if (ch === "\n") {
        e.preventDefault();
        ta.selectionStart = selectionStart! - 1;
        ta.selectionEnd = selectionStart!;
        replaceSelection(ta, " ");
        return;
      }

      // Last space between words check
      if (ch === " ") {
        const before = value.slice(0, selectionStart! - 1);
        const after = value.slice(selectionStart!);
        const cb = before[before.length - 1];
        const ca = after[0];
        if (cb && ca && /\S/.test(cb) && /\S/.test(ca)) {
          let count = 0;
          let i = selectionStart! - 1;
          while (i >= 0 && value[i] === " ") { count++; i--; }
          if (count <= 1) { e.preventDefault(); return; }
        }
      }
      return;
    }

    // Delete
    if (e.key === "Delete") {
      const { selectionStart, selectionEnd, value } = ta;
      if (selectionStart !== selectionEnd) {
        const selected = value.slice(selectionStart!, selectionEnd!);
        if (/\S/.test(selected)) { e.preventDefault(); }
        return;
      }
      if (selectionStart! >= value.length) { e.preventDefault(); return; }
      const ch = value[selectionStart!];
      if (ch !== " " && ch !== "\n") { e.preventDefault(); return; }

      // Newline → select it and replace with space
      if (ch === "\n") {
        e.preventDefault();
        ta.selectionStart = selectionStart!;
        ta.selectionEnd = selectionStart! + 1;
        replaceSelection(ta, " ");
        return;
      }

      // Last space check
      if (ch === " ") {
        const before = value.slice(0, selectionStart!);
        const after = value.slice(selectionStart! + 1);
        const cb = before[before.length - 1];
        const ca = after[0];
        if (cb && ca && /\S/.test(cb) && /\S/.test(ca)) {
          let count = 0;
          let i = selectionStart!;
          while (i < value.length && value[i] === " ") { count++; i++; }
          if (count <= 1) { e.preventDefault(); return; }
        }
      }
      return;
    }
  }, []);

  // Block paste/drop of non-whitespace
  const handleBeforeInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ie = e.nativeEvent as InputEvent;
    if (ie.inputType === "insertFromPaste" || ie.inputType === "insertFromDrop") {
      const data = ie.data || ie.dataTransfer?.getData("text/plain") || "";
      if (/\S/.test(data)) {
        e.preventDefault();
      }
    }
  }, []);

  // Notify parent of changes
  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    lastValueRef.current = ta.value;
    onChange(ta.value);
  }, [onChange]);

  return (
    <textarea
      ref={textareaRef}
      className={["spacing-editor-textarea", className].filter(Boolean).join(" ")}
      defaultValue={value}
      onKeyDown={handleKeyDown}
      onBeforeInput={handleBeforeInput}
      onInput={handleInput}
      spellCheck={false}
    />
  );
});

SpacingEditor.displayName = "SpacingEditor";

export default SpacingEditor;
