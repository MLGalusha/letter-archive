import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getRelationshipGraph,
  getRelationshipGraphByCollection,
  type GraphNode,
  type GraphEdge,
} from '../api/entities';
import { listCollections, type CollectionInfo } from '../api/collections';
import RelationshipGraph from '../components/RelationshipGraph/RelationshipGraph';
import ConnectionFinder from '../components/ConnectionFinder/ConnectionFinder';
import Footer from '../components/Footer/Footer';
import './ExplorePage.css';

export default function ExplorePage() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedNodeName, setSelectedNodeName] = useState<string | undefined>();
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [showConnectionFinder, setShowConnectionFinder] = useState(false);

  // Fetch collections on mount
  useEffect(() => {
    async function fetchCollections() {
      try {
        const data = await listCollections();
        setCollections(data.filter((c) => (c.letterCount || 0) > 0));
      } catch (err) {
        console.error('Failed to load collections:', err);
      }
    }

    fetchCollections();
  }, []);

  // Fetch graph data when collection changes
  useEffect(() => {
    async function fetchGraphData() {
      setLoading(true);
      setError(null);
      setSelectedNodeId(undefined);
      setSelectedNodeName(undefined);
      setHighlightedPath([]);

      try {
        const data =
          selectedCollection === 'all'
            ? await getRelationshipGraph()
            : await getRelationshipGraphByCollection(selectedCollection);

        setGraphData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load relationships');
      } finally {
        setLoading(false);
      }
    }

    fetchGraphData();
  }, [selectedCollection]);

  const handleNodeClick = useCallback((nodeId: string, nodeName: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? undefined : nodeId));
    setSelectedNodeName((prev) => (prev === nodeName ? undefined : nodeName));
    setHighlightedPath([]);
  }, []);

  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      navigate(`/people/${nodeId}`);
    },
    [navigate]
  );

  const handlePathFound = useCallback((path: string[]) => {
    setHighlightedPath(path);
  }, []);

  const getConnectedRelationships = () => {
    if (!selectedNodeId) return [];
    return graphData.edges.filter(
      (e) => e.source === selectedNodeId || e.target === selectedNodeId
    );
  };

  const getRelatedPersonName = (edge: GraphEdge) => {
    const relatedId = edge.source === selectedNodeId ? edge.target : edge.source;
    return graphData.nodes.find((n) => n.id === relatedId)?.name || 'Unknown';
  };

  return (
    <div className="body-layout">
      <div className="explore-page">
        <div className="explore-header">
          <h1>Explore Relationships</h1>
          <p className="page-description">
            Discover connections between people mentioned in the letters. Click a person to see
            their relationships, or double-click to view their profile.
          </p>
        </div>

        <div className="explore-controls">
          <div className="collection-selector">
            <label htmlFor="collection-select">Collection:</label>
            <select
              id="collection-select"
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
            >
              <option value="all">All Collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || c.collectionCode} ({c.letterCount} letters)
                </option>
              ))}
            </select>
          </div>

          <button
            className={`finder-toggle ${showConnectionFinder ? 'active' : ''}`}
            onClick={() => setShowConnectionFinder(!showConnectionFinder)}
          >
            {showConnectionFinder ? 'Hide' : 'Show'} Connection Finder
          </button>
        </div>

        {showConnectionFinder && (
          <ConnectionFinder
            persons={graphData.nodes.map((n) => ({ id: n.id, name: n.name }))}
            onPathFound={handlePathFound}
          />
        )}

        <div className="explore-content">
          <div className="graph-container">
            {loading && <div className="loading-overlay">Loading relationships...</div>}
            {error && <div className="error-message">{error}</div>}
            {!loading && !error && graphData.nodes.length === 0 && (
              <div className="empty-state">
                <p>No relationships found.</p>
                <p className="empty-hint">
                  {selectedCollection !== 'all'
                    ? 'Try selecting a different collection or view all collections.'
                    : 'Relationships will appear here once letters are processed.'}
                </p>
              </div>
            )}
            {!loading && !error && graphData.nodes.length > 0 && (
              <RelationshipGraph
                nodes={graphData.nodes}
                edges={graphData.edges}
                width={800}
                height={500}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={handleNodeDoubleClick}
                selectedNodeId={selectedNodeId}
                highlightedPath={highlightedPath}
              />
            )}
          </div>

          {selectedNodeId && (
            <div className="person-sidebar">
              <div className="sidebar-header">
                <h3>{selectedNodeName}</h3>
                <button className="close-btn" onClick={() => setSelectedNodeId(undefined)}>
                  ×
                </button>
              </div>

              <div className="sidebar-content">
                <div className="stat-row">
                  <span className="stat-label">Letters:</span>
                  <span className="stat-value">
                    {graphData.nodes.find((n) => n.id === selectedNodeId)?.letterCount || 0}
                  </span>
                </div>

                <h4>Relationships</h4>
                {getConnectedRelationships().length === 0 ? (
                  <p className="no-relationships">No relationships recorded</p>
                ) : (
                  <ul className="relationship-list">
                    {getConnectedRelationships().map((rel) => (
                      <li key={rel.id}>
                        <span className="rel-type">{formatRelationshipType(rel.relationshipType)}</span>
                        <span
                          className="rel-person"
                          onClick={() => navigate(`/people/${rel.source === selectedNodeId ? rel.target : rel.source}`)}
                        >
                          {getRelatedPersonName(rel)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  className="view-profile-btn"
                  onClick={() => navigate(`/people/${selectedNodeId}`)}
                >
                  View Full Profile
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="graph-instructions">
          <h4>Instructions</h4>
          <ul>
            <li>Drag to pan the graph</li>
            <li>Scroll to zoom in/out</li>
            <li>Click a person to see their relationships</li>
            <li>Double-click to view their profile page</li>
            <li>Drag nodes to rearrange the graph</li>
          </ul>
        </div>
      </div>
      <Footer />
    </div>
  );
}

function formatRelationshipType(type: string): string {
  const labels: Record<string, string> = {
    'spouse': 'Spouse of',
    'fiancé/fiancée': 'Fiancé(e) of',
    'romantic-partner': 'Romantic partner of',
    'parent-child': 'Parent/Child of',
    'sibling': 'Sibling of',
    'grandparent-grandchild': 'Grandparent/Grandchild of',
    'aunt-uncle-niece-nephew': 'Aunt/Uncle or Niece/Nephew of',
    'cousin': 'Cousin of',
    'in-law': 'In-law of',
    'friend': 'Friend of',
    'acquaintance': 'Acquaintance of',
    'business-associate': 'Business associate of',
    'employer-employee': 'Employer/Employee of',
    'unknown': 'Connected to',
  };
  return labels[type] || type;
}
