import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { applyGraphFilters, buildDiscoveryPrompts, buildGraphInsights } from './explore-utils';
import './ExplorePage.css';

export default function ExplorePage() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionInfo[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [showConnectionFinder, setShowConnectionFinder] = useState(false);
  const [relationshipTypeFilter, setRelationshipTypeFilter] = useState<string>('all');
  const [minConfidence, setMinConfidence] = useState(0);

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

  useEffect(() => {
    async function fetchGraphData() {
      setLoading(true);
      setError(null);
      setSelectedNodeId(undefined);
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

  const filteredGraphData = useMemo(
    () =>
      applyGraphFilters(graphData.nodes, graphData.edges, {
        relationshipType: relationshipTypeFilter,
        minConfidence,
      }),
    [graphData.nodes, graphData.edges, relationshipTypeFilter, minConfidence],
  );

  const fullInsights = useMemo(
    () => buildGraphInsights(graphData.nodes, graphData.edges),
    [graphData.nodes, graphData.edges],
  );

  const insights = useMemo(
    () => buildGraphInsights(filteredGraphData.nodes, filteredGraphData.edges),
    [filteredGraphData],
  );

  const discoveryPrompts = useMemo(
    () => buildDiscoveryPrompts(filteredGraphData.nodes, filteredGraphData.edges),
    [filteredGraphData.nodes, filteredGraphData.edges],
  );

  useEffect(() => {
    if (!selectedNodeId) return;
    const stillVisible = filteredGraphData.nodes.some((node) => node.id === selectedNodeId);
    if (!stillVisible) {
      setSelectedNodeId(undefined);
      setHighlightedPath([]);
    }
  }, [selectedNodeId, filteredGraphData.nodes]);

  const selectedNode = useMemo(
    () => filteredGraphData.nodes.find((node) => node.id === selectedNodeId),
    [filteredGraphData.nodes, selectedNodeId],
  );

  const connectedRelationships = useMemo(() => {
    if (!selectedNodeId) return [];
    return filteredGraphData.edges.filter(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    );
  }, [filteredGraphData.edges, selectedNodeId]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const node of graphData.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [graphData.nodes]);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId((prev) => (prev === nodeId ? undefined : nodeId));
    setHighlightedPath([]);
  }, []);

  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      navigate(`/people/${nodeId}`);
    },
    [navigate],
  );

  const connectionFinderPersons = useMemo(
    () => graphData.nodes.map((n) => ({ id: n.id, name: n.name })),
    [graphData.nodes]
  );

  const handlePathFound = useCallback((path: string[]) => {
    setHighlightedPath(path);
  }, []);

  const handleRandomPerson = () => {
    if (filteredGraphData.nodes.length === 0) return;
    const index = Math.floor(Math.random() * filteredGraphData.nodes.length);
    setSelectedNodeId(filteredGraphData.nodes[index].id);
  };

  const resetNetworkFilters = () => {
    setRelationshipTypeFilter('all');
    setMinConfidence(0);
    setHighlightedPath([]);
  };

  const focusDiscoveryPrompt = (nodeId: string, secondaryNodeId?: string) => {
    setSelectedNodeId(nodeId);
    setHighlightedPath(secondaryNodeId ? [nodeId, secondaryNodeId] : []);
  };

  const getRelatedPersonName = (edge: GraphEdge) => {
    const relatedId = edge.source === selectedNodeId ? edge.target : edge.source;
    return nodeMap.get(relatedId)?.name || 'Unknown';
  };

  return (
    <div className="body-layout">
      <div className="explore-page">
        <div className="explore-header">
          <h1>Explore Relationships</h1>
          <p className="page-description">
            Treat the archive as a living social map. Filter by relationship type, surface high-confidence connections,
            and jump from graph nodes into full public profiles.
          </p>
        </div>

        <div className="explore-metrics">
          <div className="metric-card">
            <span>People Visible</span>
            <strong>{insights.totalPeople}</strong>
          </div>
          <div className="metric-card">
            <span>Connections</span>
            <strong>{insights.totalConnections}</strong>
          </div>
          <div className="metric-card">
            <span>Avg Confidence</span>
            <strong>{insights.averageConfidence}%</strong>
          </div>
          <div className="metric-card">
            <span>Most Common Link</span>
            <strong>
              {insights.strongestType
                ? formatRelationshipType(insights.strongestType.type)
                : '—'}
            </strong>
          </div>
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

          <div className="relationship-type-filter">
            <label htmlFor="relationship-type-select">Relationship:</label>
            <select
              id="relationship-type-select"
              value={relationshipTypeFilter}
              onChange={(e) => setRelationshipTypeFilter(e.target.value)}
            >
              <option value="all">All Types</option>
              {fullInsights.typeBreakdown.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {formatRelationshipType(entry.type)} ({entry.count})
                </option>
              ))}
            </select>
          </div>

          <label className="confidence-control" htmlFor="confidence-filter">
            Min confidence
            <input
              id="confidence-filter"
              type="range"
              min={0}
              max={100}
              step={5}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
            />
            <span>{minConfidence}%</span>
          </label>

          <button
            className={`finder-toggle ${showConnectionFinder ? 'active' : ''}`}
            onClick={() => setShowConnectionFinder(!showConnectionFinder)}
          >
            {showConnectionFinder ? 'Hide' : 'Show'} Connection Finder
          </button>

          <button className="explore-action" onClick={handleRandomPerson} disabled={filteredGraphData.nodes.length === 0}>
            Random Person
          </button>

          <button className="explore-action" onClick={resetNetworkFilters}>
            Reset Filters
          </button>
        </div>

        {discoveryPrompts.length > 0 && (
          <section className="discovery-prompts">
            <h2>Story Sparks</h2>
            <p>
              Quick ways to jump into notable network patterns and verify interesting ties.
            </p>
            <div className="discovery-prompt-grid">
              {discoveryPrompts.map((prompt) => (
                <article key={prompt.id} className="discovery-prompt-card">
                  <h3>{prompt.title}</h3>
                  <p>{prompt.description}</p>
                  <button
                    type="button"
                    onClick={() => focusDiscoveryPrompt(prompt.nodeId, prompt.secondaryNodeId)}
                  >
                    Focus This Story
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {showConnectionFinder && (
          <ConnectionFinder
            persons={connectionFinderPersons}
            onPathFound={handlePathFound}
          />
        )}

        <div className="explore-content">
          <div className="graph-container">
            {loading && <div className="loading-overlay">Loading relationships...</div>}
            {error && <div className="error-message">{error}</div>}
            {!loading && !error && filteredGraphData.nodes.length === 0 && (
              <div className="empty-state">
                <p>No relationships found.</p>
                <p className="empty-hint">
                  {selectedCollection !== 'all'
                    ? 'Try selecting a different collection or reducing confidence/type filters.'
                    : 'Try reducing confidence/type filters to reveal more of the network.'}
                </p>
              </div>
            )}
            {!loading && !error && filteredGraphData.nodes.length > 0 && (
              <RelationshipGraph
                nodes={filteredGraphData.nodes}
                edges={filteredGraphData.edges}
                width={900}
                height={560}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={handleNodeDoubleClick}
                selectedNodeId={selectedNodeId}
                highlightedPath={highlightedPath}
              />
            )}
          </div>

          <div className="person-sidebar">
            <div className="sidebar-header">
              <h3>{selectedNode ? selectedNode.name : 'Discovery Panel'}</h3>
              {selectedNodeId && (
                <button className="close-btn" onClick={() => setSelectedNodeId(undefined)}>
                  ×
                </button>
              )}
            </div>

            <div className="sidebar-content">
              {selectedNode ? (
                <>
                  <div className="stat-row">
                    <span className="stat-label">Letters:</span>
                    <span className="stat-value">{selectedNode.letterCount}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Connections:</span>
                    <span className="stat-value">{connectedRelationships.length}</span>
                  </div>

                  <h4>Relationships</h4>
                  {connectedRelationships.length === 0 ? (
                    <p className="no-relationships">No relationships recorded</p>
                  ) : (
                    <ul className="relationship-list">
                      {connectedRelationships.slice(0, 12).map((rel) => (
                        <li key={rel.id}>
                          <span className="rel-type">{formatRelationshipType(rel.relationshipType)}</span>
                          <span
                            className="rel-person"
                            onClick={() =>
                              setSelectedNodeId(
                                rel.source === selectedNodeId ? rel.target : rel.source,
                              )
                            }
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
                </>
              ) : (
                <p className="discovery-tip">
                  Select a person node to inspect their relationship web. Double-click a node for the full profile page.
                </p>
              )}

              <div className="connector-block">
                <h4>Top Connectors</h4>
                {insights.connectorLeaders.length === 0 ? (
                  <p className="no-relationships">No connectors yet</p>
                ) : (
                  <ul className="connector-list">
                    {insights.connectorLeaders.map((connector) => (
                      <li key={connector.id}>
                        <button type="button" onClick={() => setSelectedNodeId(connector.id)}>
                          <span>{connector.name}</span>
                          <small>{connector.degree} links · {connector.letterCount} letters</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="graph-instructions">
          <h4>Instructions</h4>
          <ul>
            <li>Drag to pan the graph</li>
            <li>Scroll to zoom in/out</li>
            <li>Click a person to inspect their nearby network</li>
            <li>Double-click a person to open their full profile</li>
            <li>Use filters to reveal specific relationship storylines</li>
          </ul>
        </div>
      </div>
      <Footer />
    </div>
  );
}

function formatRelationshipType(type: string): string {
  const labels: Record<string, string> = {
    spouse: 'Spouse',
    'fiancé/fiancée': 'Fiancé(e)',
    'romantic-partner': 'Romantic Partner',
    'parent-child': 'Parent/Child',
    sibling: 'Sibling',
    'grandparent-grandchild': 'Grandparent/Grandchild',
    'aunt-uncle-niece-nephew': 'Aunt/Uncle or Niece/Nephew',
    cousin: 'Cousin',
    'in-law': 'In-law',
    friend: 'Friend',
    acquaintance: 'Acquaintance',
    'business-associate': 'Business Associate',
    'employer-employee': 'Employer/Employee',
    unknown: 'Connected',
  };
  return labels[type] || type;
}
