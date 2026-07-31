import type {
  LayoutBenchmarkRunSummary,
  LayoutEvaluationDecisionInput,
  LayoutEvaluationFlag,
  LayoutRepairCounts,
} from '../../../api/admin/layoutBenchmark';
import { Button } from '../../../components/common';
import type { ReviewTimer } from './useReviewTimer';
import { formatReviewTime } from './useReviewTimer';

const FLAG_OPTIONS: Array<{ value: LayoutEvaluationFlag; label: string }> = [
  { value: 'missed_line', label: 'Missed line' },
  { value: 'false_line', label: 'False line' },
  { value: 'split_line', label: 'One line split' },
  { value: 'merged_lines', label: 'Lines merged' },
  { value: 'wrong_orientation', label: 'Wrong orientation' },
  { value: 'wrong_reading_order', label: 'Wrong reading order' },
  { value: 'foreign_page_detection', label: 'Neighbor-page text included' },
  { value: 'foreign_page_false_positive', label: 'Target text marked as neighbor page' },
  { value: 'bad_region', label: 'Bad page/region boundary or type' },
  { value: 'other', label: 'Other problem' },
];

const REPAIR_OPTIONS: Array<{
  key: Exclude<keyof LayoutRepairCounts, 'total'>;
  label: string;
}> = [
  { key: 'missedLinesAdded', label: 'Lines added' },
  { key: 'falseLinesRemoved', label: 'False lines removed' },
  { key: 'splitLinesJoined', label: 'Split lines joined' },
  { key: 'mergedLinesSplit', label: 'Merged lines split' },
  { key: 'orientationCorrections', label: 'Orientation fixes' },
  { key: 'readingOrderCorrections', label: 'Order fixes' },
  { key: 'regionCorrections', label: 'Page/region fixes' },
  { key: 'other', label: 'Other repairs' },
];

interface EvaluationPanelProps {
  pageKey: string;
  leftRun: LayoutBenchmarkRunSummary;
  rightRun: LayoutBenchmarkRunSummary;
  draft: LayoutEvaluationDecisionInput;
  onDraftChange: (draft: LayoutEvaluationDecisionInput) => void;
  timer: ReviewTimer;
  reviewReady: boolean;
  controlsEnabled: boolean;
  reviewBlockReason?: string;
  revealIdentity: boolean;
  diagnosticOnly?: boolean;
  readOnly?: boolean;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
  onSave: () => void;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled: boolean;
  nextDisabled: boolean;
}

function engineLabel(run: LayoutBenchmarkRunSummary): string {
  return `${run.engineId} ${run.engineVersion}`.trim();
}

export default function EvaluationPanel({
  pageKey,
  leftRun,
  rightRun,
  draft,
  onDraftChange,
  timer,
  reviewReady,
  controlsEnabled,
  reviewBlockReason,
  revealIdentity,
  diagnosticOnly = false,
  readOnly = false,
  saving,
  saved,
  canSave,
  onSave,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
}: EvaluationPanelProps) {
  const showAssessmentForm = !diagnosticOnly && (timer.hasStarted || readOnly);

  const toggleFlag = (side: 'left' | 'right', flag: LayoutEvaluationFlag) => {
    const assessment = draft.assessments[side];
    const flags = assessment.flags.includes(flag)
      ? assessment.flags.filter((value) => value !== flag)
      : [...assessment.flags, flag];
    onDraftChange({
      ...draft,
      assessments: {
        ...draft.assessments,
        [side]: { ...assessment, flags },
      },
    });
  };

  const updateRepair = (
    side: 'left' | 'right',
    key: Exclude<keyof LayoutRepairCounts, 'total'>,
    value: number,
  ) => {
    const nextValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    const assessment = draft.assessments[side];
    const repairs = { ...assessment.repairs, [key]: nextValue };
    repairs.total = REPAIR_OPTIONS.reduce((sum, option) => sum + repairs[option.key], 0);
    onDraftChange({
      ...draft,
      assessments: {
        ...draft.assessments,
        [side]: { ...assessment, repairs },
      },
    });
  };

  return (
    <aside className="layout-evaluation" aria-label="Human evaluation">
      <div className="layout-evaluation-scroll">
        {diagnosticOnly ? (
          <section className="layout-eval-section layout-diagnostic-guide" role="status">
            <span className="layout-eyebrow">Visual inspection</span>
            <h2>Compare without ranking</h2>
            <p>
              Inspect the geometry, use Single canvas to alternate A/B, then move through the
              pages. This experiment is not saved or ranked.
            </p>
          </section>
        ) : null}
        {!diagnosticOnly ? (
          <section className="layout-eval-section layout-timer-section">
          <div className="layout-section-heading">
            <div>
              <span className="layout-eyebrow">Human effort</span>
              <h2>Timed review</h2>
            </div>
            <output className={timer.running ? 'is-running' : ''} aria-live="off">
              {formatReviewTime(timer.elapsedMs)}
            </output>
          </div>
          <p>
            {readOnly
              ? 'This saved blind verdict is locked. Start a new comparison if another review is needed.'
              : reviewReady
              ? 'Start when ready. Timing pauses if this tab or window loses focus.'
              : reviewBlockReason ?? 'Waiting for the prepared scan to decode.'}
          </p>
          <div className="layout-timer-actions">
            <Button
              size="sm"
              variant={timer.running ? 'secondary' : 'primary'}
              disabled={!reviewReady || readOnly || diagnosticOnly}
              onClick={timer.running ? timer.pause : timer.start}
            >
              {timer.running ? 'Pause' : timer.hasStarted ? 'Resume' : 'Start review'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!reviewReady || !timer.hasStarted || readOnly || diagnosticOnly}
              onClick={timer.reset}
            >
              Reset
            </Button>
          </div>
          </section>
        ) : null}

        {showAssessmentForm ? (
          <>
          <section className="layout-eval-section">
          <div className="layout-section-heading">
            <div>
              <span className="layout-eyebrow">Verdict</span>
              <h2>Which needs less repair?</h2>
            </div>
          </div>
          <div className="layout-preference-grid" role="radiogroup" aria-label="Preferred result">
            {[
              {
                value: 'left' as const,
                label: revealIdentity ? engineLabel(leftRun) : 'Run A',
                side: 'A',
              },
              {
                value: 'right' as const,
                label: revealIdentity ? engineLabel(rightRun) : 'Run B',
                side: 'B',
              },
              { value: 'tie' as const, label: 'Equivalent', side: '=' },
              { value: 'neither' as const, label: 'Neither usable', side: '×' },
            ].map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={draft.preference === choice.value}
                className={draft.preference === choice.value ? 'is-selected' : ''}
                disabled={!controlsEnabled}
                onClick={() => onDraftChange({ ...draft, preference: choice.value })}
              >
                <span>{choice.side}</span>
                <strong>{choice.label}</strong>
              </button>
            ))}
          </div>
        </section>

          <section className="layout-eval-section">
          <div className="layout-section-heading">
            <div>
              <span className="layout-eyebrow">Failure modes</span>
              <h2>What went wrong in each run?</h2>
            </div>
            <span className="layout-count-badge">
              A {draft.assessments.left.flags.length} · B {draft.assessments.right.flags.length}
            </span>
          </div>
          <div className="layout-assessment-grid layout-flag-grid">
            <span className="layout-assessment-corner">Problem</span>
            <strong className="is-a">A</strong>
            <strong className="is-b">B</strong>
            {FLAG_OPTIONS.map((option) => (
              <div className="layout-assessment-row" key={option.value}>
                <span>{option.label}</span>
                <label>
                  <span className="sr-only">{`Run A: ${option.label}`}</span>
                  <input
                    type="checkbox"
                    disabled={!controlsEnabled}
                    checked={draft.assessments.left.flags.includes(option.value)}
                    onChange={() => toggleFlag('left', option.value)}
                  />
                </label>
                <label>
                  <span className="sr-only">{`Run B: ${option.label}`}</span>
                  <input
                    type="checkbox"
                    disabled={!controlsEnabled}
                    checked={draft.assessments.right.flags.includes(option.value)}
                    onChange={() => toggleFlag('right', option.value)}
                  />
                </label>
              </div>
            ))}
          </div>
        </section>

          <section className="layout-eval-section">
          <div className="layout-section-heading">
            <div>
              <span className="layout-eyebrow">Repair burden</span>
              <h2>Estimated edits</h2>
            </div>
            <span className="layout-count-badge">
              A {draft.assessments.left.repairs.total} · B {draft.assessments.right.repairs.total}
            </span>
          </div>
          <div className="layout-assessment-grid layout-repair-grid">
            <span className="layout-assessment-corner">Repair</span>
            <strong className="is-a">A</strong>
            <strong className="is-b">B</strong>
            {REPAIR_OPTIONS.map((option) => (
              <div className="layout-assessment-row" key={option.key}>
                <span>{option.label}</span>
                <input
                  aria-label={`Run A: ${option.label}`}
                  type="number"
                  disabled={!controlsEnabled}
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.assessments.left.repairs[option.key]}
                  onChange={(event) => updateRepair(
                    'left',
                    option.key,
                    Number(event.target.value),
                  )}
                />
                <input
                  aria-label={`Run B: ${option.label}`}
                  type="number"
                  disabled={!controlsEnabled}
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={draft.assessments.right.repairs[option.key]}
                  onChange={(event) => updateRepair(
                    'right',
                    option.key,
                    Number(event.target.value),
                  )}
                />
              </div>
            ))}
          </div>
        </section>

          <section className="layout-eval-section">
          <label className="layout-confidence">
            <span>
              <span className="layout-eyebrow">Confidence</span>
              <strong>{draft.confidence ?? 3} / 5</strong>
            </span>
            <input
              type="range"
              disabled={!controlsEnabled}
              min={1}
              max={5}
              step={1}
              value={draft.confidence ?? 3}
              onChange={(event) => onDraftChange({
                ...draft,
                confidence: Number(event.target.value),
              })}
            />
          </label>
          <label className="layout-notes">
            <span>Notes</span>
            <textarea
              rows={3}
              disabled={!controlsEnabled}
              maxLength={2000}
              placeholder="What would make verification easier on this page?"
              value={draft.notes ?? ''}
              onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })}
            />
          </label>
          </section>
          </>
        ) : null}
      </div>

      <footer className="layout-evaluation-footer">
        <span className="layout-save-state" aria-live="polite">
          {saving
            ? 'Saving…'
            : diagnosticOnly
              ? `Diagnostic only · ${pageKey}`
              : readOnly || saved
                ? 'Saved · read-only'
                : `Unsaved · ${pageKey}`}
        </span>
        <div className="layout-eval-navigation">
          <Button
            size="sm"
            variant="ghost"
            icon="arrow-left"
            disabled={previousDisabled}
            onClick={onPrevious}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="save"
            loading={saving}
            disabled={!canSave}
            onClick={onSave}
          >
            {diagnosticOnly
              ? 'Diagnostic only'
              : readOnly
                ? 'Verdict locked'
                : 'Save verdict'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="arrow-right"
            iconPosition="right"
            disabled={nextDisabled}
            onClick={onNext}
          >
            Next
          </Button>
        </div>
      </footer>
    </aside>
  );
}
