import { useState, useEffect } from 'react';
import { Button, Icon, Modal } from '../common';
import {
  getPersonMergeDetails,
  getPlaceMergeDetails,
  type PersonMergeDetails,
  type PlaceMergeDetails,
} from '../../api/entities';
import './MergeComparison.css';

interface MergeComparisonProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'person' | 'place';
  entityAId: string;
  entityBId: string;
  entityAName: string;
  entityBName: string;
  onConfirm: (keepId: string, mergeId: string) => void;
}

type EntityDetails = PersonMergeDetails | PlaceMergeDetails;

function isPersonDetails(details: EntityDetails): details is PersonMergeDetails {
  return 'asSender' in details;
}

export default function MergeComparison({
  isOpen,
  onClose,
  entityType,
  entityAId,
  entityBId,
  entityAName: _entityAName,
  entityBName: _entityBName,
  onConfirm,
}: MergeComparisonProps) {
  const [loading, setLoading] = useState(true);
  const [entityADetails, setEntityADetails] = useState<EntityDetails | null>(null);
  const [entityBDetails, setEntityBDetails] = useState<EntityDetails | null>(null);
  const [keepId, setKeepId] = useState<string>(entityAId);
  const [error, setError] = useState<string | null>(null);

  // Fetch details when modal opens
  useEffect(() => {
    if (!isOpen) return;

    async function fetchDetails() {
      setLoading(true);
      setError(null);
      try {
        if (entityType === 'person') {
          const [a, b] = await Promise.all([
            getPersonMergeDetails(entityAId),
            getPersonMergeDetails(entityBId),
          ]);
          setEntityADetails(a);
          setEntityBDetails(b);
          // Default to keeping the one with more letters
          setKeepId(a.letterCount >= b.letterCount ? entityAId : entityBId);
        } else {
          const [a, b] = await Promise.all([
            getPlaceMergeDetails(entityAId),
            getPlaceMergeDetails(entityBId),
          ]);
          setEntityADetails(a);
          setEntityBDetails(b);
          setKeepId(a.letterCount >= b.letterCount ? entityAId : entityBId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load details');
      } finally {
        setLoading(false);
      }
    }

    fetchDetails();
  }, [isOpen, entityType, entityAId, entityBId]);

  const handleSwap = () => {
    setKeepId(keepId === entityAId ? entityBId : entityAId);
  };

  const handleConfirm = () => {
    const mergeId = keepId === entityAId ? entityBId : entityAId;
    onConfirm(keepId, mergeId);
  };

  // Calculate merged result preview
  const getMergedPreview = () => {
    if (!entityADetails || !entityBDetails) return null;

    const keepDetails = keepId === entityAId ? entityADetails : entityBDetails;
    const mergeDetails = keepId === entityAId ? entityBDetails : entityADetails;

    const combinedAliases = new Set([
      ...keepDetails.aliases,
      ...mergeDetails.aliases,
      mergeDetails.canonicalName,
    ]);
    combinedAliases.delete(keepDetails.canonicalName);

    return {
      name: keepDetails.canonicalName,
      aliases: Array.from(combinedAliases),
      letterCount: keepDetails.letterCount + mergeDetails.letterCount,
    };
  };

  const preview = getMergedPreview();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Merge Comparison" size="lg">
      <div className="merge-comparison">
        {loading ? (
          <div className="comparison-loading">Loading details...</div>
        ) : error ? (
          <div className="comparison-error">{error}</div>
        ) : entityADetails && entityBDetails ? (
          <>
            <div className="comparison-grid">
              {/* Entity A Column */}
              <div className={`comparison-column ${keepId === entityAId ? 'keep' : 'merge'}`}>
                <div className="column-header">
                  <label className="keep-radio">
                    <input
                      type="radio"
                      name="keepEntity"
                      checked={keepId === entityAId}
                      onChange={() => setKeepId(entityAId)}
                    />
                    <span className="radio-label">
                      {keepId === entityAId ? 'KEEP (Master)' : 'MERGE INTO ↑'}
                    </span>
                  </label>
                </div>
                <div className="entity-details">
                  <h3>{entityADetails.canonicalName}</h3>
                  <div className="detail-row">
                    <span className="label">Letters:</span>
                    <span className="value">{entityADetails.letterCount}</span>
                  </div>
                  {isPersonDetails(entityADetails) ? (
                    <>
                      <div className="detail-row">
                        <span className="label">As sender:</span>
                        <span className="value">{entityADetails.asSender}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">As recipient:</span>
                        <span className="value">{entityADetails.asRecipient}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Mentioned:</span>
                        <span className="value">{entityADetails.asMentioned}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Relationships:</span>
                        <span className="value">{entityADetails.relationshipCount}</span>
                      </div>
                      {entityADetails.relationships.length > 0 && (
                        <div className="relationships-list">
                          {entityADetails.relationships.slice(0, 3).map((rel) => (
                            <div key={rel.personId} className="relationship-item">
                              {rel.relationshipType} of {rel.personName}
                            </div>
                          ))}
                          {entityADetails.relationships.length > 3 && (
                            <div className="more-relationships">
                              +{entityADetails.relationships.length - 3} more
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="detail-row">
                        <span className="label">Written from:</span>
                        <span className="value">{entityADetails.writtenFrom}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Destination:</span>
                        <span className="value">{entityADetails.destination}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Mentioned:</span>
                        <span className="value">{entityADetails.mentioned}</span>
                      </div>
                      {entityADetails.placeType && (
                        <div className="detail-row">
                          <span className="label">Type:</span>
                          <span className="value">{entityADetails.placeType}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="detail-row">
                    <span className="label">Aliases:</span>
                    <span className="value aliases">
                      {entityADetails.aliases.length > 0
                        ? entityADetails.aliases.join(', ')
                        : '(none)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Swap Button */}
              <div className="swap-column">
                <button className="swap-btn" onClick={handleSwap} title="Swap which entity to keep">
                  <Icon name="arrows-horizontal" size={20} />
                </button>
              </div>

              {/* Entity B Column */}
              <div className={`comparison-column ${keepId === entityBId ? 'keep' : 'merge'}`}>
                <div className="column-header">
                  <label className="keep-radio">
                    <input
                      type="radio"
                      name="keepEntity"
                      checked={keepId === entityBId}
                      onChange={() => setKeepId(entityBId)}
                    />
                    <span className="radio-label">
                      {keepId === entityBId ? 'KEEP (Master)' : 'MERGE INTO ↑'}
                    </span>
                  </label>
                </div>
                <div className="entity-details">
                  <h3>{entityBDetails.canonicalName}</h3>
                  <div className="detail-row">
                    <span className="label">Letters:</span>
                    <span className="value">{entityBDetails.letterCount}</span>
                  </div>
                  {isPersonDetails(entityBDetails) ? (
                    <>
                      <div className="detail-row">
                        <span className="label">As sender:</span>
                        <span className="value">{entityBDetails.asSender}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">As recipient:</span>
                        <span className="value">{entityBDetails.asRecipient}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Mentioned:</span>
                        <span className="value">{entityBDetails.asMentioned}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Relationships:</span>
                        <span className="value">{entityBDetails.relationshipCount}</span>
                      </div>
                      {entityBDetails.relationships.length > 0 && (
                        <div className="relationships-list">
                          {entityBDetails.relationships.slice(0, 3).map((rel) => (
                            <div key={rel.personId} className="relationship-item">
                              {rel.relationshipType} of {rel.personName}
                            </div>
                          ))}
                          {entityBDetails.relationships.length > 3 && (
                            <div className="more-relationships">
                              +{entityBDetails.relationships.length - 3} more
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="detail-row">
                        <span className="label">Written from:</span>
                        <span className="value">{entityBDetails.writtenFrom}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Destination:</span>
                        <span className="value">{entityBDetails.destination}</span>
                      </div>
                      <div className="detail-row">
                        <span className="label">Mentioned:</span>
                        <span className="value">{entityBDetails.mentioned}</span>
                      </div>
                      {entityBDetails.placeType && (
                        <div className="detail-row">
                          <span className="label">Type:</span>
                          <span className="value">{entityBDetails.placeType}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="detail-row">
                    <span className="label">Aliases:</span>
                    <span className="value aliases">
                      {entityBDetails.aliases.length > 0
                        ? entityBDetails.aliases.join(', ')
                        : '(none)'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Merged Result Preview */}
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
                      {preview.aliases.length > 0 ? preview.aliases.join(', ') : '(none)'}
                    </span>
                  </div>
                  <div className="preview-row">
                    <span className="label">Letters:</span>
                    <span className="value">{preview.letterCount} (combined)</span>
                  </div>
                </div>
              </div>
            )}

            <div className="comparison-actions">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleConfirm}>
                Merge Records
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
