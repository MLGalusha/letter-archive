import type {
  CurrentRotationGeometryProposal,
} from '../../api/admin/pageGeometryProposals';

interface RotationProposalOverlayProps {
  proposal: CurrentRotationGeometryProposal;
  scaleFactor: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * Read-only candidate overlay.
 *
 * These shapes deliberately stay outside the segment editor and alignment
 * model. They are evidence for human review, not canonical page geometry.
 */
export default function RotationProposalOverlay({
  proposal,
  scaleFactor,
  imageWidth,
  imageHeight,
}: RotationProposalOverlayProps) {
  return (
    <svg
      className="line-review-rotation-proposal-overlay"
      data-proposal-id={proposal.id}
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: imageWidth,
        height: imageHeight,
        pointerEvents: 'none',
        zIndex: 6,
      }}
    >
      {proposal.artifact.candidates.map((candidate) => (
        <g key={candidate.id} data-candidate-id={candidate.id}>
          {candidate.boundary && candidate.boundary.length > 2 ? (
            <polygon
              className="line-review-rotation-proposal"
              points={candidate.boundary
                .map(({ x, y }) => (
                  `${x * scaleFactor},${y * scaleFactor}`
                ))
                .join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <rect
              className="line-review-rotation-proposal"
              x={candidate.bbox[0] * scaleFactor}
              y={candidate.bbox[1] * scaleFactor}
              width={(candidate.bbox[2] - candidate.bbox[0]) * scaleFactor}
              height={(candidate.bbox[3] - candidate.bbox[1]) * scaleFactor}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {candidate.baseline && (
            <polyline
              className="line-review-rotation-baseline"
              points={candidate.baseline
                .map(([x, y]) => (
                  `${x * scaleFactor},${y * scaleFactor}`
                ))
                .join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      ))}
    </svg>
  );
}
