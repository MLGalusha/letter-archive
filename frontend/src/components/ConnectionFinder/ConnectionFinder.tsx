import { useState, useEffect, useCallback, useMemo } from 'react';
import { getErrorMessage } from '../../api/client';
import { findConnectionPath, type PathNode, type PathEdge } from '../../api/entities';
import './ConnectionFinder.css';

interface PersonOption {
  id: string;
  name: string;
}

export interface ConnectionFinderProps {
  persons: PersonOption[];
  onPathFound?: (path: string[]) => void;
}

interface ConnectionRequestState {
  owner: string;
  loading: boolean;
  result: { path: PathNode[]; edges: PathEdge[]; message?: string } | null;
  error: string | null;
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  'spouse': 'spouse of',
  'fiancé/fiancée': 'fiancé(e) of',
  'romantic-partner': 'romantic partner of',
  'parent-child': 'parent/child of',
  'sibling': 'sibling of',
  'grandparent-grandchild': 'grandparent/grandchild of',
  'aunt-uncle-niece-nephew': 'aunt/uncle or niece/nephew of',
  'cousin': 'cousin of',
  'in-law': 'in-law of',
  'friend': 'friend of',
  'acquaintance': 'acquaintance of',
  'business-associate': 'business associate of',
  'employer-employee': 'employer/employee of',
  'unknown': 'connected to',
};

export function ConnectionFinder({ persons, onPathFound }: ConnectionFinderProps) {
  const [personA, setPersonA] = useState<string>('');
  const [personB, setPersonB] = useState<string>('');
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const [requestState, setRequestState] = useState<ConnectionRequestState | null>(null);
  const requestOwner = personA && personB ? `${personA}\0${personB}` : null;
  const currentRequest = requestState?.owner === requestOwner ? requestState : null;
  const loading = currentRequest?.loading ?? false;
  const result = currentRequest?.result ?? null;
  const error = currentRequest?.error ?? null;

  const filteredPersonsA = useMemo(
    () => persons.filter((p) => p.name.toLowerCase().includes(searchA.toLowerCase()) && p.id !== personB),
    [persons, searchA, personB]
  );
  const filteredPersonsB = useMemo(
    () => persons.filter((p) => p.name.toLowerCase().includes(searchB.toLowerCase()) && p.id !== personA),
    [persons, searchB, personA]
  );

  const handleClear = useCallback(() => {
    setPersonA('');
    setPersonB('');
    setSearchA('');
    setSearchB('');
    setRequestState(null);
    onPathFound?.([]);
  }, [onPathFound]);

  // Auto-search when both persons are selected
  useEffect(() => {
    if (!personA || !personB || !requestOwner) return;
    let active = true;
    // The pair can be initialized or replaced outside one selection event, so
    // the request lifecycle stays effect-owned and tagged to that exact pair.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- External graph request lifecycle.
    setRequestState({ owner: requestOwner, loading: true, result: null, error: null });

    void findConnectionPath(personA, personB)
      .then((connectionResult) => {
        if (!active) return;
        setRequestState({ owner: requestOwner, loading: false, result: connectionResult, error: null });
        onPathFound?.(connectionResult.path.map((person) => person.id));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setRequestState({
          owner: requestOwner,
          loading: false,
          result: null,
          error: getErrorMessage(err, 'Failed to find connection'),
        });
        console.error('Connection finder error:', err);
      });

    return () => { active = false; };
  }, [personA, personB, requestOwner, onPathFound]);

  const getPersonName = (id: string) => {
    return persons.find((p) => p.id === id)?.name || 'Unknown';
  };

  return (
    <div className="connection-finder">
      <div className="finder-header">
        <h3>Connection Finder</h3>
        <p>Find the connection between two people</p>
      </div>

      <div className="finder-inputs">
        <div className="finder-input-group">
          <label>Person A</label>
          <input
            type="text"
            placeholder="Search by name..."
            value={searchA}
            onChange={(e) => setSearchA(e.target.value)}
            className="finder-search"
          />
          {searchA && !personA && (
            <ul className="finder-suggestions">
              {filteredPersonsA.slice(0, 5).map((p) => (
                <li key={p.id} onClick={() => { setPersonA(p.id); setSearchA(p.name); }}>
                  {p.name}
                </li>
              ))}
              {filteredPersonsA.length === 0 && (
                <li className="no-results">No matches found</li>
              )}
            </ul>
          )}
          {personA && (
            <div className="selected-person">
              {getPersonName(personA)}
              <button className="clear-btn" onClick={() => { setPersonA(''); setSearchA(''); }}>×</button>
            </div>
          )}
        </div>

        <div className="finder-arrow">↔</div>

        <div className="finder-input-group">
          <label>Person B</label>
          <input
            type="text"
            placeholder="Search by name..."
            value={searchB}
            onChange={(e) => setSearchB(e.target.value)}
            className="finder-search"
          />
          {searchB && !personB && (
            <ul className="finder-suggestions">
              {filteredPersonsB.slice(0, 5).map((p) => (
                <li key={p.id} onClick={() => { setPersonB(p.id); setSearchB(p.name); }}>
                  {p.name}
                </li>
              ))}
              {filteredPersonsB.length === 0 && (
                <li className="no-results">No matches found</li>
              )}
            </ul>
          )}
          {personB && (
            <div className="selected-person">
              {getPersonName(personB)}
              <button className="clear-btn" onClick={() => { setPersonB(''); setSearchB(''); }}>×</button>
            </div>
          )}
        </div>
      </div>

      {(personA || personB || result) && (
        <button className="finder-clear-btn" onClick={handleClear}>
          Clear
        </button>
      )}

      {loading && <div className="finder-loading">Finding connection...</div>}

      {error && <div className="finder-error">{error}</div>}

      {result && (
        <div className="finder-result">
          {result.path.length === 0 ? (
            <div className="no-connection">
              {result.message || 'No connection found between these people'}
            </div>
          ) : (
            <div className="connection-path">
              <div className="path-title">Connection Path ({result.path.length - 1} degree{result.path.length !== 2 ? 's' : ''})</div>
              <div className="path-steps">
                {result.path.map((person, index) => (
                  <div key={person.id} className="path-step">
                    <span className="path-person">{person.name}</span>
                    {index < result.edges.length && (
                      <span className="path-relation">
                        is {RELATIONSHIP_LABELS[result.edges[index].type] || result.edges[index].type}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ConnectionFinder;
