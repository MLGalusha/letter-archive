import { useRef, useEffect, useCallback } from 'react';

interface EditableProps {
  value: string;
  onChange?: (value: string) => void;
  editable?: boolean;
  multiline?: boolean;
  tag?: keyof React.JSX.IntrinsicElements;
  className?: string;
  placeholder?: string;
  children?: React.ReactNode;
}

/**
 * Renders text as a normal element when `editable` is false,
 * or wraps a transparent input/textarea inside the semantic tag when `editable` is true.
 * The tag carries the styling (font-size, font-family, etc.) and the input inherits it.
 */
export default function Editable({
  value,
  onChange,
  editable,
  multiline,
  tag: Tag = 'span',
  className = '',
  placeholder,
  children,
}: EditableProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (multiline && editable) resize();
  }, [value, editable, multiline, resize]);

  if (!editable) {
    if (!value && !children) return null;
    return <Tag className={className}>{children ?? value}</Tag>;
  }

  if (multiline) {
    return (
      <Tag className={className}>
        <textarea
          ref={ref}
          className="editable-inline editable-inline--multi"
          value={value}
          onChange={(e) => { onChange?.(e.target.value); }}
          onInput={resize}
          placeholder={placeholder}
          rows={1}
        />
      </Tag>
    );
  }

  return (
    <Tag className={className}>
      <input
        type="text"
        className="editable-inline"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
      />
    </Tag>
  );
}
