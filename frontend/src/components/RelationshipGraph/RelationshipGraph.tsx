import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphNode, GraphEdge, PersonRelationshipType } from '../../api/entities';
import './RelationshipGraph.css';

interface SimulationNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  letterCount: number;
}

interface SimulationLink extends d3.SimulationLinkDatum<SimulationNode> {
  id: string;
  relationshipType: PersonRelationshipType;
  confidence: number;
}

export interface RelationshipGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  onNodeClick?: (nodeId: string, nodeName: string) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  selectedNodeId?: string;
  highlightedPath?: string[];
}

const RELATIONSHIP_COLORS: Record<PersonRelationshipType, string> = {
  'spouse': '#e91e63',
  'fiancé/fiancée': '#f06292',
  'romantic-partner': '#f48fb1',
  'parent-child': '#2196f3',
  'sibling': '#64b5f6',
  'grandparent-grandchild': '#90caf9',
  'aunt-uncle-niece-nephew': '#bbdefb',
  'cousin': '#81d4fa',
  'in-law': '#4dd0e1',
  'friend': '#4caf50',
  'acquaintance': '#81c784',
  'business-associate': '#ff9800',
  'employer-employee': '#ffb74d',
  'unknown': '#9e9e9e',
};

const RELATIONSHIP_LABELS: Record<PersonRelationshipType, string> = {
  'spouse': 'Spouse',
  'fiancé/fiancée': 'Fiancé(e)',
  'romantic-partner': 'Romantic Partner',
  'parent-child': 'Parent-Child',
  'sibling': 'Sibling',
  'grandparent-grandchild': 'Grandparent-Grandchild',
  'aunt-uncle-niece-nephew': 'Aunt/Uncle-Niece/Nephew',
  'cousin': 'Cousin',
  'in-law': 'In-Law',
  'friend': 'Friend',
  'acquaintance': 'Acquaintance',
  'business-associate': 'Business Associate',
  'employer-employee': 'Employer-Employee',
  'unknown': 'Unknown',
};

export function RelationshipGraph({
  nodes,
  edges,
  width = 800,
  height = 600,
  onNodeClick,
  onNodeDoubleClick,
  selectedNodeId,
  highlightedPath,
}: RelationshipGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredNode, setHoveredNode] = useState<SimulationNode | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const simulationRef = useRef<d3.Simulation<SimulationNode, SimulationLink> | null>(null);

  const handleZoomIn = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>();
    svg.transition().duration(300).call(zoom.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>();
    svg.transition().duration(300).call(zoom.scaleBy, 0.7);
  }, []);

  const handleResetZoom = useCallback(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom<SVGSVGElement, unknown>();
    svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  }, []);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    // Clear previous content
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Create simulation data
    const simNodes: SimulationNode[] = nodes.map((n) => ({
      ...n,
      x: undefined,
      y: undefined,
    }));

    const simLinks: SimulationLink[] = edges.map((e) => ({
      ...e,
      source: e.source,
      target: e.target,
    }));

    // Create container group for zoom/pan
    const g = svg.append('g').attr('class', 'graph-container');

    // Setup zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create force simulation
    const simulation = d3.forceSimulation<SimulationNode>(simNodes)
      .force('link', d3.forceLink<SimulationNode, SimulationLink>(simLinks)
        .id((d) => d.id)
        .distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    simulationRef.current = simulation;

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('class', 'link')
      .attr('stroke', (d) => RELATIONSHIP_COLORS[d.relationshipType])
      .attr('stroke-width', (d) => Math.max(1, d.confidence / 30))
      .attr('stroke-opacity', (d) => {
        if (!highlightedPath || highlightedPath.length === 0) return 0.6;
        const sourceId = typeof d.source === 'object' ? (d.source as SimulationNode).id : String(d.source);
        const targetId = typeof d.target === 'object' ? (d.target as SimulationNode).id : String(d.target);
        return highlightedPath.includes(sourceId) && highlightedPath.includes(targetId) ? 1 : 0.2;
      });

    // Create node groups
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, SimulationNode>('g')
      .data(simNodes)
      .join('g')
      .attr('class', 'node');

    // Add drag behavior
    const dragBehavior = d3.drag<SVGGElement, SimulationNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(dragBehavior);

    // Add circles to nodes
    node.append('circle')
      .attr('r', (d) => Math.min(30, Math.max(15, 10 + d.letterCount)))
      .attr('fill', (d) => {
        if (d.id === selectedNodeId) return '#1976d2';
        if (highlightedPath && highlightedPath.includes(d.id)) return '#4caf50';
        return '#607d8b';
      })
      .attr('stroke', (d) => d.id === selectedNodeId ? '#0d47a1' : '#37474f')
      .attr('stroke-width', (d) => d.id === selectedNodeId ? 3 : 1.5)
      .attr('opacity', (d) => {
        if (!highlightedPath || highlightedPath.length === 0) return 1;
        return highlightedPath.includes(d.id) ? 1 : 0.3;
      });

    // Add labels to nodes
    node.append('text')
      .attr('dy', (d) => Math.min(30, Math.max(15, 10 + d.letterCount)) + 14)
      .attr('text-anchor', 'middle')
      .attr('class', 'node-label')
      .text((d) => d.name.length > 15 ? d.name.substring(0, 12) + '...' : d.name)
      .attr('opacity', (d) => {
        if (!highlightedPath || highlightedPath.length === 0) return 1;
        return highlightedPath.includes(d.id) ? 1 : 0.3;
      });

    // Event handlers
    node.on('click', (event, d) => {
      event.stopPropagation();
      onNodeClick?.(d.id, d.name);
    });

    node.on('dblclick', (event, d) => {
      event.stopPropagation();
      onNodeDoubleClick?.(d.id);
    });

    node.on('mouseover', (event, d) => {
      setHoveredNode(d);
      setTooltipPosition({ x: event.pageX, y: event.pageY });
    });

    node.on('mouseout', () => {
      setHoveredNode(null);
    });

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimulationNode).x!)
        .attr('y1', (d) => (d.source as SimulationNode).y!)
        .attr('x2', (d) => (d.target as SimulationNode).x!)
        .attr('y2', (d) => (d.target as SimulationNode).y!);

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [nodes, edges, width, height, onNodeClick, onNodeDoubleClick, selectedNodeId, highlightedPath]);

  return (
    <div className="relationship-graph">
      <div className="graph-controls">
        <button className="graph-control-btn" onClick={handleZoomIn} title="Zoom In">
          +
        </button>
        <button className="graph-control-btn" onClick={handleZoomOut} title="Zoom Out">
          −
        </button>
        <button className="graph-control-btn" onClick={handleResetZoom} title="Reset View">
          ⟲
        </button>
      </div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="graph-svg"
      />
      {hoveredNode && (
        <div
          className="node-tooltip"
          style={{
            left: tooltipPosition.x + 10,
            top: tooltipPosition.y + 10,
          }}
        >
          <div className="tooltip-name">{hoveredNode.name}</div>
          <div className="tooltip-detail">
            {hoveredNode.letterCount} letter{hoveredNode.letterCount !== 1 ? 's' : ''}
          </div>
        </div>
      )}
      <div className="graph-legend">
        <div className="legend-title">Relationship Types</div>
        <div className="legend-items">
          {Object.entries(RELATIONSHIP_COLORS).slice(0, 7).map(([type, color]) => (
            <div key={type} className="legend-item">
              <span className="legend-color" style={{ backgroundColor: color }} />
              <span className="legend-label">{RELATIONSHIP_LABELS[type as PersonRelationshipType]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RelationshipGraph;
