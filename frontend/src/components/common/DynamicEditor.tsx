import { useRef, useEffect } from 'react';
import { usePretextFontSize } from '../../hooks/usePretextFontSize.js';
import './DynamicEditor.css';

interface DynamicEditorProps {
  /** Current text value */
  value: string;
  /** Called when text changes */
  onChange?: (text: string) => void;
  /** Called on input (for auto-save debouncing) */
  onInput?: (text: string) => void;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Whether to show verified styling (blue border) */
  verified?: boolean;
  /** Base font size in rem (default: 1.1) */
  baseFontSize?: number;
  /** Minimum font scale (default: 0.4 = 40% of base) */
  minFontScale?: number;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Additional CSS class */
  className?: string;
  /** Called on keydown */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called on click */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Called on double click */
  onDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/**
 * A contentEditable editor with dynamic font sizing.
 *
 * Uses Pretext for cached text measurement — prepare() runs once when text changes,
 * resize only compares cached width to container width (essentially free).
 */
export function DynamicEditor({
  value,
  onChange,
  onInput,
  placeholder = 'Enter text...',
  readOnly = false,
  verified = false,
  baseFontSize = 1.1,
  minFontScale = 0.4,
  minHeight = 200,
  className = '',
  onKeyDown,
  onClick,
  onDoubleClick,
}: DynamicEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Use Pretext-backed font sizing
  const fontSize = usePretextFontSize(editorRef, value, {
    baseFontSize,
    minScale: minFontScale,
  });

  // Set initial content in contenteditable when value changes externally
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      // Only set content if it's different (prevents cursor jumping)
      const currentContent = editor.innerText;
      if (currentContent !== value) {
        editor.innerText = value;
      }
    }
  }, [value]);

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.innerText;
    onInput?.(newText);
    onChange?.(newText);
  };

  const classNames = [
    'dynamic-editor',
    verified ? 'verified' : '',
    readOnly ? 'read-only' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={editorRef}
      className={classNames}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      style={{
        '--dynamic-editor-font-size': fontSize,
        '--dynamic-editor-min-height': `${minHeight}px`,
      } as React.CSSProperties}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}

export default DynamicEditor;
