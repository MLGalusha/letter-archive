import { Link } from 'react-router-dom';

interface NetworkNode {
  id: string;
  name: string;
  letterCount: number;
}

interface NetworkEdge {
  source: string;
  target: string;
  count: number;
  type: string | null;
}

interface CorrespondenceNetworkProps {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

function CorrespondenceNetwork({ nodes, edges }: CorrespondenceNetworkProps) {
  if (nodes.length === 0) return null;

  // For fewer than 3 nodes, render a simple list
  if (nodes.length < 3) {
    return (
      <div className="cp-network">
        <h3 className="cp-network-title">Correspondence Network</h3>
        <ul className="cp-network-list">
          {edges.map((edge, i) => {
            const source = nodes.find((n) => n.id === edge.source);
            const target = nodes.find((n) => n.id === edge.target);
            if (!source || !target) return null;
            return (
              <li key={i} className="cp-network-list-item">
                <Link to={`/people/${source.id}`}>{source.name}</Link>
                <span className="cp-network-list-arrow">&rarr;</span>
                <Link to={`/people/${target.id}`}>{target.name}</Link>
                <span className="cp-network-list-count">
                  {edge.count} letter{edge.count !== 1 ? 's' : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // Arrange nodes in a circle
  const maxLetterCount = Math.max(...nodes.map((n) => n.letterCount), 1);
  const minDot = 12;
  const maxDot = 32;
  const padding = 50; // px padding from edges for labels

  const nodePositions = nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    const x = 50 + (50 - padding / 5) * Math.cos(angle);
    const y = 50 + (50 - padding / 5) * Math.sin(angle);
    const size =
      minDot + ((node.letterCount / maxLetterCount) * (maxDot - minDot));
    return { ...node, x, y, size, angle };
  });

  const posMap = new Map(nodePositions.map((n) => [n.id, n]));

  const maxEdgeCount = Math.max(...edges.map((e) => e.count), 1);

  return (
    <div className="cp-network">
      <h3 className="cp-network-title">Correspondence Network</h3>
      <div className="cp-network-graph">
        <svg className="cp-network-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
          {edges.map((edge, i) => {
            const s = posMap.get(edge.source);
            const t = posMap.get(edge.target);
            if (!s || !t) return null;
            const thickness = 0.5 + (edge.count / maxEdgeCount) * 2;
            return (
              <line
                key={i}
                className="cp-network-edge"
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                strokeWidth={thickness}
              />
            );
          })}
        </svg>
        {nodePositions.map((node) => (
          <Link
            key={node.id}
            to={`/people/${node.id}`}
            className="cp-network-node"
            style={{
              left: `${node.x}%`,
              top: `${node.y}%`,
            }}
          >
            <div
              className="cp-network-dot"
              style={{
                width: `${node.size}px`,
                height: `${node.size}px`,
              }}
            />
            <span className="cp-network-label">{node.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default CorrespondenceNetwork;
