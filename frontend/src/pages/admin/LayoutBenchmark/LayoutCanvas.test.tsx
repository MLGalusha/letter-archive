// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NormalizedLayout } from '../../../api/admin/layoutBenchmark';
import LayoutCanvas from './LayoutCanvas';

function makeLayout(warnings: NormalizedLayout['warnings'] = []): NormalizedLayout {
  return {
    schemaVersion: 1,
    pageKey: '014-18780127-L01-02',
    runId: 'run-a',
    engineId: 'kraken6',
    image: {
      width: 100,
      height: 140,
      coordinateSpace: 'prepared-pixels-top-left',
      sourceSha256: 'source',
      preparedSha256: 'prepared',
    },
    pageBoundary: [
      { x: 5, y: 4 },
      { x: 95, y: 4 },
      { x: 95, y: 136 },
      { x: 5, y: 136 },
    ],
    regions: [],
    lines: [],
    warnings,
  };
}

function renderCanvas(
  layout: NormalizedLayout,
  options: {
    revealIdentity?: boolean;
    diagnosticStatus?: { label: string; message: string };
  } = {},
) {
  return render(
    <LayoutCanvas
      title={options.revealIdentity === false ? 'Run A' : 'A · kraken6'}
      subtitle={options.revealIdentity === false ? 'Identity hidden' : 'run-a'}
      imageUrl="/prepared.png"
      width={100}
      height={140}
      layers={[{
        id: 'run-a',
        label: 'A',
        color: '#1876d2',
        layout,
      }]}
      overlayOpacity={1}
      showPageBoundary
      showRegions={false}
      showLines={false}
      showReadingOrder={false}
      revealIdentity={options.revealIdentity}
      diagnosticStatus={options.diagnosticStatus}
    />,
  );
}

describe('LayoutCanvas page boundary', () => {
  it('renders a provider page boundary as a distinct overlay', () => {
    const { container } = renderCanvas(makeLayout());

    expect(container.querySelector('polygon title')).toHaveTextContent(
      'A detected target-page boundary',
    );
  });

  it('labels an image-frame fallback as unavailable and does not draw it', () => {
    const { container } = renderCanvas(makeLayout([{
      code: 'PAGE_BOUNDARY_UNAVAILABLE',
      message: 'Provider did not return a page boundary',
    }]));

    expect(screen.getByRole('status')).toHaveTextContent(
      'page boundary unavailable (image frame is only a fallback)',
    );
    expect(container.querySelector('polygon')).toBeNull();
  });

  it('keeps DOM overlay metadata and provider warnings blind before save', () => {
    const blindLayout = makeLayout([{
      code: 'KRACKEN_PROVIDER_WARNING',
      message: 'Kraken-specific vectorizer warning',
    }]);
    blindLayout.lines = [{
      id: 'kraken6-run-a:secret-line-id',
      regionId: null,
      class: 'text_line',
      boundary: [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 20 },
        { x: 10, y: 20 },
      ],
      baseline: null,
      orientationDegrees: 0,
      readingOrder: null,
      confidence: null,
    }];

    const { container } = render(
      <LayoutCanvas
        title="Run A"
        subtitle="Identity hidden until this verdict is saved"
        imageUrl="/prepared.png"
        width={100}
        height={140}
        layers={[{
          id: 'kraken6-run-a',
          label: 'A',
          color: '#1876d2',
          layout: blindLayout,
        }]}
        overlayOpacity={1}
        showPageBoundary
        showRegions={false}
        showLines
        showReadingOrder={false}
        revealIdentity={false}
      />,
    );

    expect(container.querySelector('g[data-layer="A"]')).toBeInTheDocument();
    expect(container.querySelector('g[data-layer="kraken6-run-a"]')).toBeNull();
    expect(container.querySelector('.layout-canvas-warnings')).toBeNull();
    expect(container.innerHTML).not.toContain('KRACKEN_PROVIDER_WARNING');
    expect(container.innerHTML).not.toContain('secret-line-id');
    expect(container.innerHTML).not.toContain('1 lines · 0 regions');
    expect(screen.getByText('Counts reveal after save')).toBeInTheDocument();
    expect(container.querySelectorAll('polygon title')[1]).toHaveTextContent('A line 1');
  });

  it('marks partial failed geometry as diagnostic evidence', () => {
    renderCanvas(makeLayout(), {
      diagnosticStatus: {
        label: 'Failed / truncated output',
        message: 'The configured line cap was reached.',
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Failed / truncated output');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The configured line cap was reached.',
    );
  });
});
