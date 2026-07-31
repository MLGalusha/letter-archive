import type {
  NormalizedLayout,
  LayoutPoint,
} from '../../../api/admin/layoutBenchmark';
import type { ReactNode } from 'react';

export interface LayoutCanvasLayer {
  id: string;
  label: string;
  color: string;
  layout: NormalizedLayout;
}

interface LayoutCanvasProps {
  title: string;
  subtitle: string;
  imageUrl: string;
  width: number;
  height: number;
  layers: LayoutCanvasLayer[];
  overlayOpacity: number;
  showPageBoundary: boolean;
  showRegions: boolean;
  showLines: boolean;
  showReadingOrder: boolean;
  revealIdentity?: boolean;
  diagnosticStatus?: {
    label: string;
    message: string;
  };
  diagnosticActions?: ReactNode;
  onImageLoad?: (image: HTMLImageElement) => void;
  onImageError?: () => void;
}

function pointsValue(points: LayoutPoint[]): string {
  return points.map(({ x, y }) => `${x},${y}`).join(' ');
}

function labelPoint(points: LayoutPoint[]): LayoutPoint | null {
  if (points.length === 0) return null;
  return points.reduce(
    (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
    { x: 0, y: 0 },
  );
}

function OverlayLayer({
  layer,
  opacity,
  showPageBoundary,
  showRegions,
  showLines,
  showReadingOrder,
  revealIdentity,
}: {
  layer: LayoutCanvasLayer;
  opacity: number;
  showPageBoundary: boolean;
  showRegions: boolean;
  showLines: boolean;
  showReadingOrder: boolean;
  revealIdentity: boolean;
}) {
  const { layout, color } = layer;
  const labelScale = Math.max(layout.image.width, layout.image.height) / 900;
  const pageBoundaryUnavailable = layout.warnings.some(
    (warning) => warning.code === 'PAGE_BOUNDARY_UNAVAILABLE',
  );

  return (
    <g data-layer={layer.label} style={{ color }} opacity={opacity}>
      {showPageBoundary && !pageBoundaryUnavailable && (
        <polygon
          points={pointsValue(layout.pageBoundary)}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
        >
          <title>{`${layer.label} detected target-page boundary`}</title>
        </polygon>
      )}

      {showRegions && layout.regions.map((region) => (
        <polygon
          key={region.id}
          points={pointsValue(region.boundary)}
          fill="currentColor"
          fillOpacity={0.06}
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray="10 7"
          vectorEffect="non-scaling-stroke"
        >
          <title>{`${layer.label} region: ${region.class}`}</title>
        </polygon>
      ))}

      {showLines && layout.lines.map((line, lineIndex) => {
        const rotationEvidence = line.provenance?.attributes?.rotationEnsemble;
        const sourceRotation = rotationEvidence?.representativeRotationDegrees ?? 0;
        const isRotatedProposal = revealIdentity && sourceRotation !== 0;
        const title = `${layer.label} line ${
          line.readingOrder?.index ?? lineIndex + 1
        }${
          revealIdentity ? ` · ${line.id}` : ''
        }${
          isRotatedProposal
            ? ` · proposed by ${sourceRotation}° pass${
              rotationEvidence?.sourceRotationsDegrees?.length
                ? ` · evidence ${rotationEvidence.sourceRotationsDegrees.join('° / ')}°`
                : ''
            }`
            : ''
        }`;

        return (
          <g
            key={line.id}
            data-source-rotation={
              revealIdentity
                ? rotationEvidence?.representativeRotationDegrees
                : undefined
            }
          >
            <polygon
              points={pointsValue(line.boundary)}
              fill="currentColor"
              fillOpacity={isRotatedProposal ? 0.1 : 0.05}
              stroke="currentColor"
              strokeWidth={isRotatedProposal ? 3 : 2}
              strokeDasharray={isRotatedProposal ? '9 6' : undefined}
              vectorEffect="non-scaling-stroke"
            >
              <title>{title}</title>
            </polygon>
            {line.baseline && (
              <polyline
                points={pointsValue(line.baseline)}
                fill="none"
                stroke="currentColor"
                strokeWidth={isRotatedProposal ? 2.5 : 1.5}
                strokeDasharray={isRotatedProposal ? '9 6' : undefined}
                vectorEffect="non-scaling-stroke"
              >
                <title>{title}</title>
              </polyline>
            )}
            {showReadingOrder && line.readingOrder && (() => {
              const point = labelPoint(line.boundary);
              if (!point) return null;
              return (
                <g transform={`translate(${point.x} ${point.y})`}>
                  <circle
                    r={10 * labelScale}
                    fill="currentColor"
                    stroke="white"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <text
                    x={0}
                    y={3.5 * labelScale}
                    fill="white"
                    fontSize={10 * labelScale}
                    fontWeight={700}
                    textAnchor="middle"
                  >
                    {line.readingOrder.index}
                  </text>
                </g>
              );
            })()}
          </g>
        );
      })}
    </g>
  );
}

export default function LayoutCanvas({
  title,
  subtitle,
  imageUrl,
  width,
  height,
  layers,
  overlayOpacity,
  showPageBoundary,
  showRegions,
  showLines,
  showReadingOrder,
  revealIdentity = true,
  diagnosticStatus,
  diagnosticActions,
  onImageLoad,
  onImageError,
}: LayoutCanvasProps) {
  const warnings = layers.flatMap((layer) => layer.layout.warnings.map((warning) => ({
    ...warning,
    layerLabel: layer.label,
  })));

  return (
    <article className={`layout-canvas-card${diagnosticStatus ? ' is-diagnostic-output' : ''}`}>
      {diagnosticStatus ? (
        <div className="layout-canvas-diagnostic" role="alert">
          <strong>{diagnosticStatus.label}</strong>
          <span>{diagnosticStatus.message}</span>
          {diagnosticActions}
        </div>
      ) : null}
      <header className="layout-canvas-header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p title={subtitle}>{subtitle}</p> : null}
        </div>
        {revealIdentity ? (
          <div
            className="layout-canvas-counts"
            aria-label="Detected geometry counts"
          >
            {layers.map((layer) => (
              <span key={layer.id} style={{ '--layer-color': layer.color } as React.CSSProperties}>
                <i aria-hidden />
                {layer.layout.lines.length} lines · {layer.layout.regions.length} regions
              </span>
            ))}
          </div>
        ) : <span className="sr-only">Counts reveal after save</span>}
      </header>
      {revealIdentity && warnings.length > 0 && (
        <div className="layout-canvas-warnings" role="status">
          {warnings.map((warning, index) => (
            <span
              key={`${warning.layerLabel}-${warning.code}-${index}`}
              title={warning.message}
            >
              {warning.layerLabel}: {warning.code === 'PAGE_BOUNDARY_UNAVAILABLE'
                ? 'page boundary unavailable (image frame is only a fallback)'
                : warning.message}
            </span>
          ))}
        </div>
      )}

      <div className="layout-canvas-scroll">
        <div
          className="layout-canvas-frame"
          style={{ width: '100%', aspectRatio: `${width} / ${height}` }}
        >
          <img
            src={imageUrl}
            alt={`Prepared benchmark scan for ${title}`}
            width={width}
            height={height}
            draggable={false}
            onLoad={(event) => onImageLoad?.(event.currentTarget)}
            onError={onImageError}
          />
          <svg
            className="layout-canvas-overlay"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {layers.map((layer) => (
              <OverlayLayer
                key={layer.id}
                layer={layer}
                opacity={overlayOpacity}
                showPageBoundary={showPageBoundary}
                showRegions={showRegions}
                showLines={showLines}
                showReadingOrder={showReadingOrder}
                revealIdentity={revealIdentity}
              />
            ))}
          </svg>
        </div>
      </div>
    </article>
  );
}
