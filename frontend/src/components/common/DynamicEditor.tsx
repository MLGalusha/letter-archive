import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import './DynamicEditor.css';

export interface DynamicEditorRef {
  /** Get the current text content */
  getText: () => string;
  /** Set the text content programmatically */
  setText: (text: string) => void;
  /** Focus the editor */
  focus: () => void;
  /** Get the underlying DOM element */
  getElement: () => HTMLDivElement | null;
}

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
 * The font automatically shrinks to fit the longest line without horizontal scrolling,
 * making it ideal for monospace transcription text where line breaks should be preserved.
 */
export const DynamicEditor = forwardRef<DynamicEditorRef, DynamicEditorProps>(({
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
}, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(`${baseFontSize}rem`);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getText: () => editorRef.current?.innerText || '',
    setText: (text: string) => {
      if (editorRef.current) {
        editorRef.current.innerText = text;
      }
    },
    focus: () => editorRef.current?.focus(),
    getElement: () => editorRef.current,
  }));

  // Calculate font size based on longest line to prevent wrapping
  const calculateFontSize = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !value) {
      setFontSize(`${baseFontSize}rem`);
      return;
    }

    // Get computed styles for padding and font
    const computedStyle = window.getComputedStyle(editor);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    const containerWidth = editor.clientWidth - paddingLeft - paddingRight;
    const lines = value.split('\n');

    // Create canvas for measuring text
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use computed font to match actual rendering
    const fontFamily = computedStyle.fontFamily || 'monospace';
    ctx.font = `${baseFontSize * 16}px ${fontFamily}`; // Convert rem to px (assuming 16px base)

    // Find the widest line
    let maxWidth = 0;
    for (const line of lines) {
      if (line.trim()) {
        const width = ctx.measureText(line).width;
        if (width > maxWidth) maxWidth = width;
      }
    }

    // Calculate scale factor (with a minimum to prevent text being too small)
    if (maxWidth > containerWidth) {
      const scale = Math.max(minFontScale, containerWidth / maxWidth);
      setFontSize(`${baseFontSize * scale}rem`);
    } else {
      setFontSize(`${baseFontSize}rem`);
    }
  }, [value, baseFontSize, minFontScale]);

  // Recalculate font size when value changes or on container resize
  useEffect(() => {
    calculateFontSize();

    // Use ResizeObserver to detect container size changes (from split pane drag)
    const editor = editorRef.current;
    const editorContainer = editor?.parentElement;

    if (editor || editorContainer) {
      const resizeObserver = new ResizeObserver(() => {
        calculateFontSize();
      });
      if (editor) resizeObserver.observe(editor);
      if (editorContainer) resizeObserver.observe(editorContainer);
      return () => resizeObserver.disconnect();
    }

    // Fallback: window resize
    window.addEventListener('resize', calculateFontSize);
    return () => window.removeEventListener('resize', calculateFontSize);
  }, [calculateFontSize]);

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
});

DynamicEditor.displayName = 'DynamicEditor';

export default DynamicEditor;
