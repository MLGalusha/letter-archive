import { useRef, useEffect, type TextareaHTMLAttributes } from 'react';
import './Form.css';

export interface AutoResizeTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  /** Current value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Maximum height in pixels (optional) */
  maxHeight?: number;
}

export function AutoResizeTextarea({
  value,
  onChange,
  minHeight = 80,
  maxHeight,
  className = '',
  ...props
}: AutoResizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set to scrollHeight or minHeight, whichever is larger
      const newHeight = Math.max(textarea.scrollHeight, minHeight);
      // Apply maxHeight constraint if specified
      textarea.style.height = maxHeight
        ? `${Math.min(newHeight, maxHeight)}px`
        : `${newHeight}px`;
    }
  }, [value, minHeight, maxHeight]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`form-textarea auto-resize ${className}`}
      style={{ minHeight: `${minHeight}px`, maxHeight: maxHeight ? `${maxHeight}px` : undefined }}
      {...props}
    />
  );
}

export default AutoResizeTextarea;
