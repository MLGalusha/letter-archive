import type { LayoutBenchmarkRunSummary } from '../../../api/admin/layoutBenchmark';

export type RunFamily =
  | 'baselines'
  | 'page-isolation'
  | 'rotation'
  | 'other';

interface RunPresentation {
  name: string;
  purpose: string;
  family: RunFamily;
  order: number;
}

export interface RunOption {
  run: LayoutBenchmarkRunSummary;
  earlier: boolean;
}

export interface RunOptionGroup {
  id: RunFamily | 'earlier';
  label: string;
  options: RunOption[];
}

export interface ResolvedComparisonPreset {
  id: string;
  label: string;
  description: string;
  leftRunId: string;
  rightRunId: string;
}

const RUN_FAMILY_LABELS: Record<RunFamily, string> = {
  baselines: 'Baselines',
  'page-isolation': 'Page isolation + sideways text',
  rotation: 'Rotation experiments',
  other: 'Other diagnostics',
};

const RUN_FAMILY_ORDER: RunFamily[] = [
  'baselines',
  'page-isolation',
  'rotation',
  'other',
];

const RUN_PRESENTATIONS: Record<string, RunPresentation> = {
  kraken6: {
    name: 'Kraken 6 baseline',
    purpose: 'The original BLLA result used as the upgrade control.',
    family: 'baselines',
    order: 20,
  },
  kraken7: {
    name: 'Kraken 7 baseline',
    purpose: 'Plain Kraken 7 BLLA with no page mask or rotated passes.',
    family: 'baselines',
    order: 10,
  },
  eynollah: {
    name: 'Eynollah layout baseline',
    purpose: 'Eynollah detects page regions and lines without Kraken.',
    family: 'baselines',
    order: 30,
  },
  'eynollah-v091': {
    name: 'Eynollah 0.9.1 baseline',
    purpose: 'The current Eynollah layout detector used for page-boundary evidence.',
    family: 'baselines',
    order: 31,
  },
  'eynollah-v091-cl': {
    name: 'Eynollah 0.9.1 column mode',
    purpose: 'Eynollah with column detection enabled.',
    family: 'baselines',
    order: 32,
  },
  'kraken7-rot3-eyno-mask-p0-safe-zones': {
    name: 'Strict page mask + 3-way sideways recovery',
    purpose: 'Best current experiment: hide neighboring-page pixels, then keep sideways lines only when they pass the safety gate.',
    family: 'page-isolation',
    order: 10,
  },
  'kraken7-rot3-eyno-mask-p16-safe-zones': {
    name: 'Padded page mask + 3-way sideways recovery',
    purpose: 'Keep a 16 px edge margin before guarded sideways-line recovery; this protects edge ink but may admit neighboring text.',
    family: 'page-isolation',
    order: 20,
  },
  'kraken7-rot3-eyno-mask-p0': {
    name: 'Strict page mask + 3 rotations (raw)',
    purpose: 'Hide everything outside the detected page, then keep raw results from upright and both sideways passes.',
    family: 'page-isolation',
    order: 30,
  },
  'kraken7-rot3-eyno-mask-p16': {
    name: 'Padded page mask + 3 rotations (raw)',
    purpose: 'Keep a 16 px page-edge margin, then combine raw upright and sideways passes before safety filtering.',
    family: 'page-isolation',
    order: 40,
  },
  'kraken7-eyno-mask-p0': {
    name: 'Strict page mask only',
    purpose: 'Run ordinary Kraken only on pixels inside the detected page boundary.',
    family: 'page-isolation',
    order: 50,
  },
  'kraken7-eyno-mask-p16': {
    name: 'Padded page mask only',
    purpose: 'Run ordinary Kraken inside the detected page plus a 16 px edge margin.',
    family: 'page-isolation',
    order: 60,
  },
  'kraken7-eyno-boundary-filter': {
    name: 'Page-boundary display filter',
    purpose: 'Hide lines whose centers fall outside Eynollah’s page boundary; this is a display projection, not a detector.',
    family: 'page-isolation',
    order: 70,
  },
  'kraken7-rot3-safe-zones': {
    name: '3 rotations · guarded sideways lines',
    purpose: 'Add sideways lines only in coherent vertical zones without strong upright-text interference.',
    family: 'rotation',
    order: 10,
  },
  'kraken7-rot3-safe-zones-ablation': {
    name: '3 rotations · guarded lines from 4-pass evidence',
    purpose: 'Remove the 180° pass from the same frozen four-pass evidence and keep the safety gate unchanged.',
    family: 'rotation',
    order: 20,
  },
  'kraken7-rot4-safe-zones-replay': {
    name: '4 rotations · guarded sideways lines',
    purpose: 'Use upright, both sideways, and 180° evidence with the same safety gate.',
    family: 'rotation',
    order: 30,
  },
  'kraken7-rot3-union-ablation': {
    name: '3 rotations · keep every detection (stress test)',
    purpose: 'Keep every unique detection from three rotations so false-positive growth stays visible.',
    family: 'rotation',
    order: 40,
  },
  'kraken7-rot4-union': {
    name: '4 rotations · keep every detection (stress test)',
    purpose: 'Keep every unique detection from all four rotations; useful as a deliberately noisy control.',
    family: 'rotation',
    order: 50,
  },
  'kraken7-rot3-consensus-ablation': {
    name: '3 rotations · consensus only',
    purpose: 'Add a rotated line only when at least two selected orientations support it.',
    family: 'rotation',
    order: 60,
  },
  'kraken7-rot4-consensus': {
    name: '4 rotations · consensus only',
    purpose: 'Require agreement between rotated passes before adding non-upright lines.',
    family: 'rotation',
    order: 70,
  },
  'kraken7-rot4-consensus-replay': {
    name: '4 rotations · consensus replay',
    purpose: 'Apply the four-pass consensus rule to the same frozen evidence used by the three-pass comparison.',
    family: 'rotation',
    order: 80,
  },
  'kraken7-rot3-zones': {
    name: '3 rotations · spatial sideways zones',
    purpose: 'Propose sideways-text zones from nearby rotated detections without requiring cross-rotation consensus.',
    family: 'rotation',
    order: 90,
  },
  'kraken7-orli': {
    name: 'Kraken Orli line model',
    purpose: 'Test Kraken’s newer Orli line detector on the local accelerator.',
    family: 'other',
    order: 10,
  },
  'kraken7-orli-cpu': {
    name: 'Kraken Orli · CPU',
    purpose: 'Run Orli on CPU to separate accelerator behavior from model behavior.',
    family: 'other',
    order: 20,
  },
  'kraken7-orli-cap128': {
    name: 'Kraken Orli · 128-line cap',
    purpose: 'A bounded failure-path check, not a full-quality detector run.',
    family: 'other',
    order: 30,
  },
  'kraken7-orli-cpu-cap128': {
    name: 'Kraken Orli · CPU · 128-line cap',
    purpose: 'A bounded CPU failure-path check, not a full-quality detector run.',
    family: 'other',
    order: 40,
  },
};

const COMPARISON_PRESETS = [
  {
    id: 'best-vs-baseline',
    label: 'Best candidate vs baseline',
    description: 'Start here: does strict page isolation plus guarded sideways recovery beat plain Kraken 7?',
    leftEngineId: 'kraken7-rot3-eyno-mask-p0-safe-zones',
    rightEngineId: 'kraken7',
  },
  {
    id: 'three-vs-four',
    label: '3 vs 4 rotations',
    description: 'Does the extra 180° pass add useful lines, or mostly add noise?',
    leftEngineId: 'kraken7-rot3-safe-zones-ablation',
    rightEngineId: 'kraken7-rot4-safe-zones-replay',
  },
  {
    id: 'safe-vs-union',
    label: 'Safe gate vs raw union',
    description: 'Compare guarded recovery with “keep everything” to see where false positives come from.',
    leftEngineId: 'kraken7-rot3-safe-zones-ablation',
    rightEngineId: 'kraken7-rot3-union-ablation',
  },
] as const;

export function runPresentation(run: LayoutBenchmarkRunSummary): RunPresentation {
  return RUN_PRESENTATIONS[run.engineId] ?? {
    name: run.engineId,
    purpose: run.diagnostic?.purpose
      ?? 'No plain-language description has been added for this experimental method yet.',
    family: 'other',
    order: 1_000,
  };
}

export function runStatusLabel(run: LayoutBenchmarkRunSummary): string {
  const failure = run.failed > 0 ? ` · ${run.failed} failed` : '';
  return `${run.succeeded}/${run.selected} passed${failure}`;
}

export function formatRunDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function comparePrimaryRuns(
  left: LayoutBenchmarkRunSummary,
  right: LayoutBenchmarkRunSummary,
): number {
  return right.selected - left.selected
    || left.failed - right.failed
    || right.succeeded - left.succeeded
    || Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function primaryRunsByEngine(
  runs: LayoutBenchmarkRunSummary[],
): Map<string, LayoutBenchmarkRunSummary> {
  const grouped = new Map<string, LayoutBenchmarkRunSummary[]>();
  runs.forEach((run) => {
    grouped.set(run.engineId, [...(grouped.get(run.engineId) ?? []), run]);
  });
  return new Map([...grouped].map(([engineId, engineRuns]) => (
    [engineId, [...engineRuns].sort(comparePrimaryRuns)[0]]
  )));
}

export function earlierRunCount(runs: LayoutBenchmarkRunSummary[]): number {
  return Math.max(0, runs.length - primaryRunsByEngine(runs).size);
}

export function runOptionLabel(
  run: LayoutBenchmarkRunSummary,
  earlier = false,
): string {
  const date = earlier ? ` · ${formatRunDate(run.createdAt)}` : '';
  return `${runPresentation(run).name} — ${runStatusLabel(run)}${date}`;
}

export function runOptionGroups(
  runs: LayoutBenchmarkRunSummary[],
  options: {
    excludeRunId: string;
    selectedRunId: string;
    showEarlier: boolean;
  },
): RunOptionGroup[] {
  const primaryIds = new Set(
    [...primaryRunsByEngine(runs).values()].map((run) => run.runId),
  );
  const available = runs.filter((run) => run.runId !== options.excludeRunId);
  const primary = available.filter((run) => primaryIds.has(run.runId));
  const earlier = available.filter((run) => (
    !primaryIds.has(run.runId)
    && (options.showEarlier || run.runId === options.selectedRunId)
  ));

  const groups = RUN_FAMILY_ORDER.flatMap((family): RunOptionGroup[] => {
    const familyRuns = primary
      .filter((run) => runPresentation(run).family === family)
      .sort((left, right) => (
        runPresentation(left).order - runPresentation(right).order
        || runPresentation(left).name.localeCompare(runPresentation(right).name)
      ));
    return familyRuns.length > 0
      ? [{
          id: family,
          label: RUN_FAMILY_LABELS[family],
          options: familyRuns.map((run) => ({ run, earlier: false })),
        }]
      : [];
  });

  if (earlier.length > 0) {
    groups.push({
      id: 'earlier',
      label: options.showEarlier ? 'Earlier / supporting runs' : 'Earlier run (selected)',
      options: [...earlier]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map((run) => ({ run, earlier: true })),
    });
  }
  return groups;
}

export function resolveComparisonPresets(
  runs: LayoutBenchmarkRunSummary[],
): ResolvedComparisonPreset[] {
  const primary = primaryRunsByEngine(runs);
  return COMPARISON_PRESETS.flatMap((preset): ResolvedComparisonPreset[] => {
    const left = primary.get(preset.leftEngineId);
    const right = primary.get(preset.rightEngineId);
    return left && right
      ? [{
          id: preset.id,
          label: preset.label,
          description: preset.description,
          leftRunId: left.runId,
          rightRunId: right.runId,
        }]
      : [];
  });
}

export function pairMatchesPreset(
  preset: ResolvedComparisonPreset,
  leftRunId: string,
  rightRunId: string,
): boolean {
  return (
    preset.leftRunId === leftRunId && preset.rightRunId === rightRunId
  ) || (
    preset.leftRunId === rightRunId && preset.rightRunId === leftRunId
  );
}
