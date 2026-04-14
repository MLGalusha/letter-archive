import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SegmentClass } from '../../types/Letter';

interface SegmentContextMenuProps {
  x: number;
  y: number;
  currentClass: SegmentClass | undefined;
  excluded: boolean;
  onClassify: (cls: SegmentClass) => void;
  onToggleExcluded: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}

export default function SegmentContextMenu({
  x,
  y,
  currentClass,
  excluded,
  onClassify,
  onToggleExcluded,
  onDelete,
  onDuplicate,
  onClose,
}: SegmentContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const cls = currentClass ?? 'body';
  const classes: SegmentClass[] = ['body', 'continuation', 'addition', 'ignore'];

  return createPortal(
    <div
      ref={menuRef}
      className="seg-context-menu"
      style={{ left: x, top: y }}
    >
      <div
        className="seg-context-item seg-context-classify"
        onMouseEnter={() => setClassifyOpen(true)}
        onMouseLeave={() => setClassifyOpen(false)}
      >
        <span>Classify</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ marginLeft: 'auto' }}>
          <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {classifyOpen && (
          <div className="seg-context-submenu">
            {classes.map((c) => (
              <button
                key={c}
                className={`seg-context-item seg-context-class-${c}${cls === c ? ' active' : ''}`}
                onClick={() => { onClassify(c); onClose(); }}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="seg-context-item"
        onClick={() => { onToggleExcluded(); onClose(); }}
      >
        {excluded ? 'Include' : 'Exclude'}
      </button>
      <button
        className="seg-context-item"
        onClick={() => { onDuplicate(); onClose(); }}
      >
        Duplicate
      </button>
      <div className="seg-context-divider" />
      <button
        className="seg-context-item seg-context-danger"
        onClick={() => { onDelete(); onClose(); }}
      >
        Delete
      </button>
    </div>,
    document.body,
  );
}
