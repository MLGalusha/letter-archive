import { useState, useMemo, useEffect } from 'react';
import { Button, Modal } from '../common';
import './BulkMergeModal.css';

interface SelectedEntity {
  id: string;
  name: string;
  letterCount: number;
  aliases: string[];
}

interface BulkMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'person' | 'place';
  selectedEntities: SelectedEntity[];
  onConfirm: (keepId: string, mergeIds: string[]) => void;
  loading?: boolean;
}

export default function BulkMergeModal({
  isOpen,
  onClose,
  entityType,
  selectedEntities,
  onConfirm,
  loading = false,
}: BulkMergeModalProps) {
  // Default to entity with most letters as master
  const defaultMasterId = useMemo(() => {
    if (selectedEntities.length === 0) return '';
    return selectedEntities.reduce((prev, curr) =>
      curr.letterCount > prev.letterCount ? curr : prev
    ).id;
  }, [selectedEntities]);

  const [masterId, setMasterId] = useState<string>(defaultMasterId);

  // Reset master when entities change
  useEffect(() => {
    setMasterId(defaultMasterId);
  }, [defaultMasterId]);

  const masterEntity = selectedEntities.find((e) => e.id === masterId);
  const mergeEntities = selectedEntities.filter((e) => e.id !== masterId);

  // Calculate preview
  const preview = useMemo(() => {
    if (!masterEntity) return null;

    const allAliases = new Set<string>();
    let totalLetters = masterEntity.letterCount;

    // Add master's aliases
    masterEntity.aliases.forEach((a) => allAliases.add(a));

    // Add all merge entities' names and aliases
    mergeEntities.forEach((entity) => {
      allAliases.add(entity.name);
      entity.aliases.forEach((a) => allAliases.add(a));
      totalLetters += entity.letterCount;
    });

    // Remove master name from aliases
    allAliases.delete(masterEntity.name);

    return {
      name: masterEntity.name,
      aliases: Array.from(allAliases),
      letterCount: totalLetters,
      mergeCount: mergeEntities.length,
    };
  }, [masterEntity, mergeEntities]);

  const handleConfirm = () => {
    if (!masterId) return;
    const mergeIds = mergeEntities.map((e) => e.id);
    onConfirm(masterId, mergeIds);
  };

  const entityLabel = entityType === 'person' ? 'people' : 'places';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Bulk Merge ${selectedEntities.length} ${entityLabel}`} size="lg">
      <div className="bulk-merge-modal">
        <p className="merge-description">
          Select the master {entityType} to keep. All other {entityLabel} will be merged into it
          and their letter associations will be transferred.
        </p>

        <div className="entities-list">
          {selectedEntities.map((entity) => (
            <label
              key={entity.id}
              className={`entity-option ${entity.id === masterId ? 'master' : ''}`}
            >
              <input
                type="radio"
                name="masterId"
                value={entity.id}
                checked={entity.id === masterId}
                onChange={() => setMasterId(entity.id)}
              />
              <div className="entity-info">
                <span className="entity-name">{entity.name}</span>
                <span className="entity-meta">
                  {entity.letterCount} letters
                  {entity.aliases.length > 0 && (
                    <span className="entity-aliases">
                      ({entity.aliases.slice(0, 3).join(', ')}
                      {entity.aliases.length > 3 && '...'})
                    </span>
                  )}
                </span>
              </div>
              {entity.id === masterId && <span className="master-badge">KEEP</span>}
            </label>
          ))}
        </div>

        {preview && (
          <div className="result-preview">
            <h4>Result Preview:</h4>
            <div className="preview-content">
              <div className="preview-row">
                <span className="label">Name:</span>
                <span className="value">{preview.name}</span>
              </div>
              <div className="preview-row">
                <span className="label">Aliases:</span>
                <span className="value">
                  {preview.aliases.length > 0
                    ? preview.aliases.slice(0, 5).join(', ') +
                      (preview.aliases.length > 5 ? ` (+${preview.aliases.length - 5} more)` : '')
                    : '(none)'}
                </span>
              </div>
              <div className="preview-row">
                <span className="label">Letters:</span>
                <span className="value">{preview.letterCount} (combined)</span>
              </div>
              <div className="preview-row warning">
                <span className="label">Will delete:</span>
                <span className="value">{preview.mergeCount} {entityLabel}</span>
              </div>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={!masterId || mergeEntities.length === 0 || loading}
          >
            {loading ? 'Merging...' : `Merge ${mergeEntities.length} into ${masterEntity?.name || 'Selected'}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
