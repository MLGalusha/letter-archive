import type { LetterReviewVisit } from './useLetterReviewVisit';

export const ALL_LETTER_REVIEW_AUTOSAVE_LANES = [
  'letter-fields',
  'identity',
  'extra-content',
  'photo-description',
] as const;

export type LetterReviewAutosaveLane =
  (typeof ALL_LETTER_REVIEW_AUTOSAVE_LANES)[number];

export type LetterReviewAutosaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error';

export interface LetterReviewDebouncedSaveOptions {
  lane: LetterReviewAutosaveLane;
  delayMs?: number;
  errorMessage: string;
  onError?: (error: unknown) => void;
}

export type ScheduleLetterReviewDebouncedSave = (
  task: () => Promise<void>,
  options: LetterReviewDebouncedSaveOptions,
) => void;

export type FlushLetterReviewDebouncedSaves = (
  lanes: readonly LetterReviewAutosaveLane[],
) => Promise<boolean>;

export type CancelLetterReviewDebouncedSaves = (
  lanes: readonly LetterReviewAutosaveLane[],
) => void;

export interface LetterReviewAutosaveRuntime {
  visit: LetterReviewVisit;
  targetKey: string | null;
  isMutationBlocked: () => boolean;
  handleMutationError: (error: unknown, fallback: string) => boolean;
}

interface Job extends LetterReviewDebouncedSaveOptions {
  sequence: number;
  targetKey: string;
  visit: LetterReviewVisit;
  task: () => Promise<void>;
  isMutationBlocked: () => boolean;
  handleMutationError: LetterReviewAutosaveRuntime['handleMutationError'];
  ready: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

interface TargetQueue {
  running: Job | null;
  queuedByLane: Map<LetterReviewAutosaveLane, Job>;
  failureByLane: Map<LetterReviewAutosaveLane, {
    count: number;
    error: unknown;
    errorMessage: string;
    reported: boolean;
    visit: LetterReviewVisit;
  }>;
  waiters: Set<() => void>;
}

interface VisitState {
  status: LetterReviewAutosaveStatus;
  started: boolean;
  failed: boolean;
}

const DEFAULT_DELAY_MS = 1_500;

export class LetterReviewAutosaveCoordinator {
  private active = true;
  private sequence = 0;
  private readonly targets = new Map<string, TargetQueue>();
  private readonly visits = new Map<LetterReviewVisit, VisitState>();
  private readonly runtime: { current: LetterReviewAutosaveRuntime };
  private readonly onChange: () => void;

  constructor(
    runtime: { current: LetterReviewAutosaveRuntime },
    onChange: () => void,
  ) {
    this.runtime = runtime;
    this.onChange = onChange;
  }

  activate = () => {
    this.active = true;
  };

  deactivate = () => {
    this.active = false;
    for (const target of this.targets.values()) {
      for (const job of target.queuedByLane.values()) {
        if (job.timer) clearTimeout(job.timer);
      }
      const affectedVisits = new Set(
        [...target.queuedByLane.values()].map((job) => job.visit),
      );
      target.queuedByLane.clear();
      for (const visit of affectedVisits) this.settleVisit(visit);
      this.wake(target);
    }
  };

  schedule: ScheduleLetterReviewDebouncedSave = (task, options) => {
    const owner = this.runtime.current;
    if (
      !this.active
      || !owner.targetKey
      || owner.isMutationBlocked()
    ) {
      return;
    }

    const target = this.getTarget(owner.targetKey);
    const replaced = target.queuedByLane.get(options.lane);
    if (replaced) {
      if (replaced.timer) clearTimeout(replaced.timer);
      target.queuedByLane.delete(options.lane);
      this.settleVisit(replaced.visit);
    }

    if (!this.hasWork(owner.visit)) {
      this.visits.set(owner.visit, {
        status: 'idle',
        started: false,
        failed: this.hasUnresolvedFailure(owner.visit),
      });
    }

    const job: Job = {
      ...options,
      sequence: ++this.sequence,
      targetKey: owner.targetKey,
      visit: owner.visit,
      task,
      isMutationBlocked: owner.isMutationBlocked,
      handleMutationError: owner.handleMutationError,
      ready: false,
      timer: null,
    };
    target.queuedByLane.set(job.lane, job);
    job.timer = setTimeout(() => {
      job.timer = null;
      job.ready = true;
      this.pump(target);
      this.changed(target);
    }, Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS));
    this.changed(target);
  };

  flush: FlushLetterReviewDebouncedSaves = async (lanes) => {
    const owner = this.runtime.current;
    const selected = new Set(lanes);
    if (
      !this.active
      || !owner.targetKey
      || owner.isMutationBlocked()
    ) {
      if (owner.targetKey) this.cancelQueuedTarget(owner.targetKey);
      return false;
    }
    if (selected.size === 0) return true;

    const target = this.targets.get(owner.targetKey);
    const priorStatus = this.visitState(owner.visit).status;
    if (!target) return priorStatus !== 'error';

    for (const [lane, job] of target.queuedByLane) {
      if (!selected.has(lane)) continue;
      if (job.timer) clearTimeout(job.timer);
      job.timer = null;
      job.ready = true;
    }
    this.pump(target);
    this.changed(target);

    while (this.hasTargetLaneWork(target, selected)) {
      await new Promise<void>((resolve) => {
        target.waiters.add(resolve);
      });
    }

    if (!owner.visit.isActive() || owner.isMutationBlocked()) return false;
    let succeeded = true;
    for (const lane of selected) {
      const failure = target.failureByLane.get(lane);
      if (!failure) continue;

      succeeded = false;
      if (failure.visit !== owner.visit) {
        const previousVisit = failure.visit;
        failure.visit = owner.visit;
        const previousState = this.visitState(previousVisit);
        previousState.failed = this.hasUnresolvedFailure(previousVisit);
        this.settleVisit(previousVisit);
      }
      if (!failure.reported && owner.visit.isActive()) {
        try {
          owner.handleMutationError(
            failure.error,
            failure.errorMessage,
          );
          failure.reported = true;
        } catch {
          // Reporting a carried failure must not strand the flush waiter.
        }
      }
    }
    if (!succeeded) {
      const state = this.visitState(owner.visit);
      state.started = true;
      state.failed = true;
      this.settleVisit(owner.visit);
    } else {
      const state = this.visitState(owner.visit);
      state.failed = this.hasUnresolvedFailure(owner.visit);
      this.settleVisit(owner.visit);
      if (state.status === 'error') succeeded = false;
    }
    this.pruneSettledOwners();
    return succeeded;
  };

  cancel: CancelLetterReviewDebouncedSaves = (lanes) => {
    const targetKey = this.runtime.current.targetKey;
    if (!targetKey || lanes.length === 0) return;
    this.cancelQueuedLanes(targetKey, new Set(lanes));
  };

  cancelQueuedTarget = (targetKey: string) => {
    this.cancelQueuedLanes(targetKey);
  };

  snapshot(visit: LetterReviewVisit) {
    this.pruneSettledOwners();
    const busyLanes = new Set<LetterReviewAutosaveLane>();
    for (const target of this.targets.values()) {
      if (target.running?.visit === visit) {
        busyLanes.add(target.running.lane);
      }
      for (const job of target.queuedByLane.values()) {
        if (job.visit === visit) busyLanes.add(job.lane);
      }
    }
    return {
      autoSaveStatus: this.visitState(visit).status,
      busyLanes: busyLanes as ReadonlySet<LetterReviewAutosaveLane>,
    };
  }

  private cancelQueuedLanes(
    targetKey: string,
    selected?: ReadonlySet<LetterReviewAutosaveLane>,
  ) {
    const target = this.targets.get(targetKey);
    if (!target) return;
    const affectedVisits = new Set<LetterReviewVisit>();
    for (const [lane, job] of target.queuedByLane) {
      if (selected && !selected.has(lane)) continue;
      if (job.timer) clearTimeout(job.timer);
      affectedVisits.add(job.visit);
      target.queuedByLane.delete(lane);
    }
    if (affectedVisits.size === 0) return;
    for (const visit of affectedVisits) this.settleVisit(visit);
    this.changed(target);
  }

  private getTarget(targetKey: string): TargetQueue {
    let target = this.targets.get(targetKey);
    if (!target) {
      target = {
        running: null,
        queuedByLane: new Map(),
        failureByLane: new Map(),
        waiters: new Set(),
      };
      this.targets.set(targetKey, target);
    }
    return target;
  }

  private visitState(visit: LetterReviewVisit): VisitState {
    let state = this.visits.get(visit);
    if (!state) {
      state = { status: 'idle', started: false, failed: false };
      this.visits.set(visit, state);
    }
    return state;
  }

  private hasWork(visit: LetterReviewVisit): boolean {
    for (const target of this.targets.values()) {
      if (target.running?.visit === visit) return true;
      for (const job of target.queuedByLane.values()) {
        if (job.visit === visit) return true;
      }
    }
    return false;
  }

  private hasUnresolvedFailure(visit: LetterReviewVisit): boolean {
    for (const target of this.targets.values()) {
      for (const failure of target.failureByLane.values()) {
        if (failure.visit === visit) return true;
      }
    }
    return false;
  }

  private settleVisit(visit: LetterReviewVisit) {
    const state = this.visitState(visit);
    if (this.hasWork(visit)) {
      state.status = state.started ? 'saving' : 'idle';
      return;
    }
    state.status = state.started
      ? (state.failed ? 'error' : 'saved')
      : 'idle';
  }

  private hasTargetLaneWork(
    target: TargetQueue,
    lanes: ReadonlySet<LetterReviewAutosaveLane>,
  ): boolean {
    if (target.running && lanes.has(target.running.lane)) return true;
    for (const lane of lanes) {
      if (target.queuedByLane.has(lane)) return true;
    }
    return false;
  }

  private pump(target: TargetQueue) {
    if (!this.active || target.running) return;
    const next = [...target.queuedByLane.values()]
      .filter((job) => job.ready)
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (!next) return;

    target.queuedByLane.delete(next.lane);
    if (next.visit.isActive() && next.isMutationBlocked()) {
      this.settleVisit(next.visit);
      this.changed(target);
      this.pump(target);
      return;
    }

    target.running = next;
    const state = this.visitState(next.visit);
    state.started = true;
    state.status = 'saving';
    this.changed(target);
    void this.run(target, next);
  }

  private async run(target: TargetQueue, job: Job) {
    let failed = false;
    let failureError: unknown;
    let failureReported = false;
    try {
      await job.task();
    } catch (error) {
      failed = true;
      failureError = error;
      try {
        job.onError?.(error);
      } catch {
        // Logging callbacks must not break the target's serial queue.
      }
      if (this.isVisible(job)) {
        try {
          job.handleMutationError(error, job.errorMessage);
          failureReported = true;
        } catch {
          // A UI error callback must not strand later writes in the queue.
        }
      }
    } finally {
      if (failed) {
        const previous = target.failureByLane.get(job.lane);
        const failures = previous?.count ?? 0;
        target.failureByLane.set(job.lane, {
          count: failures + 1,
          error: failureError,
          errorMessage: job.errorMessage,
          reported: failureReported,
          visit: job.visit,
        });
        if (previous && previous.visit !== job.visit) {
          const previousState = this.visitState(previous.visit);
          previousState.failed = this.hasUnresolvedFailure(previous.visit);
          this.settleVisit(previous.visit);
        }
        this.visitState(job.visit).failed = true;
      } else {
        const resolved = target.failureByLane.get(job.lane);
        if (resolved) {
          target.failureByLane.delete(job.lane);
          const resolvedState = this.visitState(resolved.visit);
          resolvedState.failed = this.hasUnresolvedFailure(resolved.visit);
          this.settleVisit(resolved.visit);
        }
        const state = this.visitState(job.visit);
        state.failed = this.hasUnresolvedFailure(job.visit);
      }
      if (target.running === job) target.running = null;
      this.pump(target);
      this.settleVisit(job.visit);
      this.changed(target);
    }
  }

  private isVisible(job: Job): boolean {
    return (
      this.active
      && this.runtime.current.visit === job.visit
      && job.visit.isActive()
    );
  }

  private wake(target: TargetQueue) {
    const waiters = [...target.waiters];
    target.waiters.clear();
    for (const resolve of waiters) resolve();
  }

  private changed(target: TargetQueue) {
    this.wake(target);
    this.pruneSettledOwners();
    if (this.active) this.onChange();
  }

  private pruneSettledOwners() {
    for (const [targetKey, target] of this.targets) {
      if (
        !target.running
        && target.queuedByLane.size === 0
        && target.waiters.size === 0
        && target.failureByLane.size === 0
      ) {
        this.targets.delete(targetKey);
      }
    }
    for (const visit of this.visits.keys()) {
      if (!visit.isActive() && !this.hasWork(visit)) {
        this.visits.delete(visit);
      }
    }
  }
}
