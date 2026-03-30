import { useRef, useCallback, useEffect } from "react";

interface SpacingEditorProps {
  /** The reading view text (independent from raw transcript) */
  value: string;
  /** Called when the user modifies spacing */
  onChange: (text: string) => void;
}

/**
 * A plain textarea for the reading view. The user can only modify
 * whitespace — word content and order are locked by the edit view.
 */
export default function SpacingEditor({ value, onChange }: SpacingEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cloneRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize via offscreen clone to avoid scroll jumps (defined first so effects can use it)
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    if (!cloneRef.current) {
      cloneRef.current = document.createElement("textarea");
      const s = cloneRef.current.style;
      s.position = "absolute";
      s.top = "-9999px";
      s.left = "-9999px";
      s.visibility = "hidden";
      s.height = "auto";
      s.overflow = "hidden";
      document.body.appendChild(cloneRef.current);
    }

    const clone = cloneRef.current;
    const cs = getComputedStyle(el);
    clone.style.width = cs.width;
    clone.style.padding = cs.padding;
    clone.style.border = cs.border;
    clone.style.font = cs.font;
    clone.style.lineHeight = cs.lineHeight;
    clone.style.letterSpacing = cs.letterSpacing;
    clone.style.wordSpacing = cs.wordSpacing;
    clone.style.boxSizing = cs.boxSizing;
    clone.value = el.value;

    const needed = clone.scrollHeight;
    if (Math.abs(el.offsetHeight - needed) > 1) {
      el.style.height = needed + "px";
    }
  }, []);

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
    autoResize(ta);
  }, [value, autoResize]);

  // Initial setup
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = value;
      autoResize(textareaRef.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up clone on unmount
  useEffect(() => {
    return () => {
      if (cloneRef.current) {
        document.body.removeChild(cloneRef.current);
        cloneRef.current = null;
      }
    };
  }, []);

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
      document.execCommand("insertText", false, "    ");
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
        document.execCommand("insertText", false, " ");
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
        document.execCommand("insertText", false, " ");
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
    autoResize(ta);
    lastValueRef.current = ta.value;
    onChange(ta.value);
  }, [autoResize, onChange]);

  return (
    <textarea
      ref={textareaRef}
      className="spacing-editor-textarea"
      defaultValue={value}
      onKeyDown={handleKeyDown}
      onBeforeInput={handleBeforeInput}
      onInput={handleInput}
      spellCheck={false}
    />
  );
}
