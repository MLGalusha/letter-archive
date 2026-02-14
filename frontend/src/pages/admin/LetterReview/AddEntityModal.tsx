import { useState } from "react";
import { PERSON_ROLE_OPTIONS, PLACE_ROLE_OPTIONS } from "../../../constants/enums";

interface AddEntityModalProps {
  type: "person" | "place";
  isOpen: boolean;
  isAdding: boolean;
  onClose: () => void;
  onAdd: (name: string, role: string) => Promise<void>;
}

export default function AddEntityModal({ type, isOpen, isAdding, onClose, onAdd }: AddEntityModalProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("mentioned");

  if (!isOpen) return null;

  const roles = type === "person" ? PERSON_ROLE_OPTIONS : PLACE_ROLE_OPTIONS;
  const title = type === "person" ? "Add Linked Person" : "Add Linked Place";
  const placeholder = type === "person" ? "Enter person's name" : "Enter place name";
  const buttonText = type === "person" ? "Add Person" : "Add Place";

  const handleClose = () => {
    setName("");
    setRole("mentioned");
    onClose();
  };

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      await onAdd(name.trim(), role);
      setName("");
      setRole("mentioned");
    } catch (err) {
      console.error(`Failed to add ${type}:`, err);
    }
  };

  return (
    <div className="confirm-dialog-overlay" onClick={handleClose}>
      <div className="confirm-dialog add-entity-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="form-group">
          <label htmlFor={`new${type}Name`}>Name</label>
          <input
            type="text"
            id={`new${type}Name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder}
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor={`new${type}Role`}>Role</label>
          <select
            id={`new${type}Role`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <div className="confirm-dialog-actions">
          <button className="btn-cancel" onClick={handleClose}>
            Cancel
          </button>
          <button
            className="btn-confirm"
            disabled={!name.trim() || isAdding}
            onClick={handleAdd}
          >
            {isAdding ? "Adding..." : buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
