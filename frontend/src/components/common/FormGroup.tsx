import type { ReactNode } from 'react';
import './Form.css';

export interface FormGroupProps {
  /** Label text */
  label: string;
  /** ID for the form element (links label to input) */
  id: string;
  /** Error message */
  error?: string;
  /** Helper text shown below the input */
  helperText?: string;
  /** Whether the field is required */
  required?: boolean;
  /** The form element (input, textarea, select, etc) */
  children: ReactNode;
  /** Additional class name */
  className?: string;
}

export function FormGroup({
  label,
  id,
  error,
  helperText,
  required = false,
  children,
  className = '',
}: FormGroupProps) {
  return (
    <div className={`form-group ${error ? 'form-group-error' : ''} ${className}`}>
      <label htmlFor={id} className="form-label">
        {label}
        {required && <span className="form-required">*</span>}
      </label>
      {children}
      {error && <span className="form-error">{error}</span>}
      {helperText && !error && <span className="form-helper">{helperText}</span>}
    </div>
  );
}

export default FormGroup;
