import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import './Button.css';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Button style variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Icon to display */
  icon?: IconName;
  /** Position of icon relative to text */
  iconPosition?: 'left' | 'right';
  /** Active/toggled state */
  active?: boolean;
  /** Loading state */
  loading?: boolean;
  /** Button content */
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconPosition = 'left',
  active = false,
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 20 : 18;

  return (
    <button
      className={`btn btn-${variant} btn-${size} ${active ? 'btn-active' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="btn-spinner" />
      ) : (
        <>
          {icon && iconPosition === 'left' && <Icon name={icon} size={iconSize} />}
          {children && <span className="btn-text">{children}</span>}
          {icon && iconPosition === 'right' && <Icon name={icon} size={iconSize} />}
        </>
      )}
    </button>
  );
}

/** Icon-only button (square) */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  tooltip?: string;
}

export function IconButton({
  icon,
  variant = 'secondary',
  size = 'md',
  active = false,
  tooltip,
  className = '',
  ...props
}: IconButtonProps) {
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 20 : 18;

  return (
    <button
      className={`btn-icon btn-icon-${variant} btn-icon-${size} ${active ? 'btn-active' : ''} ${className}`}
      title={tooltip}
      {...props}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
}

export default Button;
