import { describe, expect, it } from 'vitest';
import type { LayoutBenchmarkRunSummary } from '../../../../api/admin/layoutBenchmark';
import {
  earlierRunCount,
  resolveComparisonPresets,
  runOptionGroups,
  runOptionLabel,
  runPresentation,
} from '../runPresentation';

function run(
  runId: string,
  engineId: string,
  selected: number,
  createdAt: string,
  failed = 0,
): LayoutBenchmarkRunSummary {
  return {
    runId,
    state: failed > 0 ? 'completed_with_failures' : 'completed',
    engineId,
    engineVersion: '1',
    adapterVersion: '1',
    preprocessingProfileId: 'layout-benchmark-v1',
    preprocessingProfileSha256: 'a'.repeat(64),
    createdAt,
    completedAt: createdAt,
    selected,
    succeeded: selected - failed,
    failed,
    durationMs: 1,
    diagnostic: engineId === 'kraken7'
      ? null
      : {
          equivalentToDefaultProfile: false,
          comparisonProfile: null,
          purpose: null,
          capReachedIsQualityFailure: false,
        },
  };
}

describe('layout benchmark run presentation', () => {
  it('uses concise human names while preserving an honest unknown-engine fallback', () => {
    const candidate = run(
      'p0-safe-full',
      'kraken7-rot3-eyno-mask-p0-safe-zones',
      8,
      '2026-07-29T04:00:00.000Z',
    );
    const unknown = run(
      'unknown-full',
      'future-layout-engine',
      8,
      '2026-07-29T04:00:00.000Z',
    );

    expect(runOptionLabel(candidate)).toBe(
      'Strict page mask + 3-way sideways recovery — 8/8 passed',
    );
    expect(runPresentation(unknown)).toMatchObject({
      name: 'future-layout-engine',
      family: 'other',
    });
  });

  it('shows one broad current run per method and keeps a selected earlier run visible', () => {
    const current = run(
      'p0-safe-current',
      'kraken7-rot3-eyno-mask-p0-safe-zones',
      8,
      '2026-07-29T04:14:00.000Z',
    );
    const earlierSameSize = run(
      'p0-safe-earlier',
      'kraken7-rot3-eyno-mask-p0-safe-zones',
      8,
      '2026-07-29T03:43:00.000Z',
    );
    const smoke = run(
      'p0-safe-smoke',
      'kraken7-rot3-eyno-mask-p0-safe-zones',
      3,
      '2026-07-29T04:13:00.000Z',
    );
    const baseline = run(
      'kraken7-full',
      'kraken7',
      66,
      '2026-07-28T09:47:00.000Z',
    );
    const runs = [smoke, earlierSameSize, current, baseline];

    const groups = runOptionGroups(runs, {
      excludeRunId: baseline.runId,
      selectedRunId: earlierSameSize.runId,
      showEarlier: false,
    });

    expect(earlierRunCount(runs)).toBe(2);
    expect(groups.find((group) => group.id === 'page-isolation')?.options)
      .toEqual([{ run: current, earlier: false }]);
    expect(groups.find((group) => group.id === 'earlier')?.options)
      .toEqual([{ run: earlierSameSize, earlier: true }]);
    expect(groups.flatMap((group) => group.options).some(({ run: optionRun }) => (
      optionRun.runId === smoke.runId
    ))).toBe(false);
  });

  it('resolves suggested comparisons to the broad current run for each method', () => {
    const runs = [
      run(
        'p0-safe-smoke',
        'kraken7-rot3-eyno-mask-p0-safe-zones',
        3,
        '2026-07-29T04:13:00.000Z',
      ),
      run(
        'p0-safe-full',
        'kraken7-rot3-eyno-mask-p0-safe-zones',
        8,
        '2026-07-29T04:14:00.000Z',
      ),
      run('kraken7-full', 'kraken7', 66, '2026-07-28T09:47:00.000Z'),
    ];

    expect(resolveComparisonPresets(runs)).toEqual([
      expect.objectContaining({
        id: 'best-vs-baseline',
        leftRunId: 'p0-safe-full',
        rightRunId: 'kraken7-full',
      }),
    ]);
  });
});
