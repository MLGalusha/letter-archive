import { useState, useEffect, useRef } from "react";

/**
 * Inline editable entity item component
 */
export default function EditableEntityItem({
  id,
  name,
  role,
  confidence,
  onSave,
  onRemove,
  isVerified,
}: {
  id: string;
  name: string;
  role: string;
  confidence: number;
  onSave: (newName: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  isVerified?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (editValue.trim() === name || !editValue.trim()) {
      setEditValue(name);
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(editValue.trim());
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save entity name:", err);
      setEditValue(name);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditValue(name);
      setIsEditing(false);
    }
  };

  const handleRemove = async () => {
    if (!onRemove) return;
    setIsSaving(true);
    try {
      await onRemove();
    } catch (err) {
      console.error("Failed to remove entity:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div key={id} className="entity-item">
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          className="entity-name-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
        />
      ) : (
        <span
          className={`entity-name ${!isVerified ? "editable" : ""}`}
          onClick={!isVerified ? () => setIsEditing(true) : undefined}
          title={!isVerified ? "Click to edit" : undefined}
        >
          {name}
        </span>
      )}
      <span className={`entity-role role-${role}`}>{role}</span>
      <span className="entity-confidence">{confidence}%</span>
      {onRemove && !isVerified && (
        <button
          type="button"
          className="entity-remove-btn"
          onClick={handleRemove}
          disabled={isSaving}
          title="Remove from letter"
        >
          ×
        </button>
      )}
    </div>
  );
}
