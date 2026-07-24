import type { RetagMetadataChange } from '../../../api/admin/letters';
import type { Letter } from '../../../types/Letter';
import type { LetterReviewVisit } from './useLetterReviewVisit';

export interface IdentityUpdateData {
  sender?: string | null;
  recipient?: string | null;
}

export interface IdentityTarget {
  key: string;
  letterId: string;
  visit: LetterReviewVisit;
  primarySourceRevision: number;
  sender: string | null;
  recipient: string | null;
}

interface IdentityBaseline {
  primarySourceRevision: number;
  sender: string | null;
  recipient: string | null;
}

export interface PendingIdentityUpdate extends IdentityBaseline {
  targetKey: string;
  letterId: string;
  visit: LetterReviewVisit;
  generation: number;
  nextSender?: string | null;
  nextRecipient?: string | null;
}

export interface IdentityJob {
  targetKey: string;
  generation: number;
}

export interface IdentityTransaction {
  pending: PendingIdentityUpdate;
  updateData: {
    primarySourceRevision: number;
    expectedSender?: string | null;
    expectedRecipient?: string | null;
    sender?: string;
    recipient?: string;
  };
  retagChange: RetagMetadataChange;
}

export type StageIdentityUpdateResult =
  | { kind: 'cancel' }
  | { kind: 'schedule'; job: IdentityJob };

export interface AcceptIdentityResult {
  canceledPending: PendingIdentityUpdate | null;
}

export interface RejectIdentityResult extends AcceptIdentityResult {
  retryPending: PendingIdentityUpdate | null;
}

const senderAfter = (pending: PendingIdentityUpdate) => (
  pending.nextSender !== undefined
    ? pending.nextSender
    : pending.sender
);

const recipientAfter = (pending: PendingIdentityUpdate) => (
  pending.nextRecipient !== undefined
    ? pending.nextRecipient
    : pending.recipient
);

const hasChanges = (pending: PendingIdentityUpdate) => (
  senderAfter(pending) !== pending.sender
  || recipientAfter(pending) !== pending.recipient
);

/**
 * Owns only identity intent and compare-and-set payload construction.
 *
 * React visit visibility, timers, API execution, and errors stay in the hook.
 * The scheduler still owns target-wide serialization.
 */
export class IdentityAutoSaveController {
  private generation = 0;
  private readonly pendingByTarget = new Map<
    string,
    PendingIdentityUpdate
  >();
  private readonly activeBaselineByTarget = new Map<
    string,
    IdentityBaseline & { generation: number }
  >();

  stage(
    target: IdentityTarget,
    data: IdentityUpdateData,
  ): StageIdentityUpdateResult {
    const pendingForTarget = this.pendingByTarget.get(target.key);
    const pending = pendingForTarget?.visit === target.visit
      ? pendingForTarget
      : undefined;
    const active = this.activeBaselineByTarget.get(target.key);
    const baseline = pending ?? {
      targetKey: target.key,
      letterId: target.letterId,
      visit: target.visit,
      generation: 0,
      primarySourceRevision:
        active?.primarySourceRevision ?? target.primarySourceRevision,
      sender: active ? active.sender : target.sender,
      recipient: active ? active.recipient : target.recipient,
    };
    const generation = ++this.generation;
    const next: PendingIdentityUpdate = {
      ...baseline,
      visit: target.visit,
      generation,
      ...(data.sender !== undefined
        ? { nextSender: data.sender ?? null }
        : {}),
      ...(data.recipient !== undefined
        ? { nextRecipient: data.recipient ?? null }
        : {}),
    };

    if (!hasChanges(next)) {
      this.pendingByTarget.delete(target.key);
      return { kind: 'cancel' };
    }

    this.pendingByTarget.set(target.key, next);
    return {
      kind: 'schedule',
      job: { targetKey: target.key, generation },
    };
  }

  begin(job: IdentityJob): IdentityTransaction | null {
    const pending = this.pendingByTarget.get(job.targetKey);
    if (!pending || pending.generation !== job.generation) return null;
    this.pendingByTarget.delete(job.targetKey);

    const nextSender = senderAfter(pending);
    const nextRecipient = recipientAfter(pending);
    const senderChanged = (
      pending.nextSender !== undefined
      && nextSender !== pending.sender
    );
    const recipientChanged = (
      pending.nextRecipient !== undefined
      && nextRecipient !== pending.recipient
    );
    if (!senderChanged && !recipientChanged) return null;

    this.activeBaselineByTarget.set(job.targetKey, {
      generation: job.generation,
      primarySourceRevision: pending.primarySourceRevision,
      sender: nextSender,
      recipient: nextRecipient,
    });

    const updateData: IdentityTransaction['updateData'] = {
      primarySourceRevision: pending.primarySourceRevision,
    };
    if (senderChanged) {
      updateData.expectedSender = pending.sender;
      updateData.sender = nextSender ?? '';
    }
    if (recipientChanged) {
      updateData.expectedRecipient = pending.recipient;
      updateData.recipient = nextRecipient ?? '';
    }

    return {
      pending,
      updateData,
      retagChange: {
        primarySourceRevision: pending.primarySourceRevision,
        field: senderChanged && recipientChanged
          ? 'both'
          : senderChanged
            ? 'sender'
            : 'recipient',
        ...(senderChanged
          ? { oldSender: pending.sender, newSender: nextSender }
          : {}),
        ...(recipientChanged
          ? {
              oldRecipient: pending.recipient,
              newRecipient: nextRecipient,
            }
          : {}),
      },
    };
  }

  owns(job: IdentityJob): boolean {
    return (
      this.pendingByTarget.get(job.targetKey)?.generation
      === job.generation
    );
  }

  accept(
    transaction: IdentityTransaction,
    updated: Letter,
  ): AcceptIdentityResult {
    const { pending } = transaction;
    this.activeBaselineByTarget.set(pending.targetKey, {
      generation: pending.generation,
      primarySourceRevision: updated.primarySourceRevision,
      sender: updated.metadata.sender ?? null,
      recipient: updated.metadata.recipient ?? null,
    });

    return this.rebasePending(pending.targetKey, {
      primarySourceRevision: updated.primarySourceRevision,
      sender: updated.metadata.sender ?? null,
      recipient: updated.metadata.recipient ?? null,
    });
  }

  reject(transaction: IdentityTransaction): RejectIdentityResult {
    const { pending } = transaction;
    this.activeBaselineByTarget.set(pending.targetKey, {
      generation: pending.generation,
      primarySourceRevision: pending.primarySourceRevision,
      sender: pending.sender,
      recipient: pending.recipient,
    });
    const newer = this.pendingByTarget.get(pending.targetKey);
    const canRestoreFailedIntent = (
      !newer || newer.visit === pending.visit
    );
    const restored: PendingIdentityUpdate = {
      ...(newer ?? pending),
      visit: newer?.visit ?? pending.visit,
      generation: newer?.generation ?? ++this.generation,
      primarySourceRevision: pending.primarySourceRevision,
      sender: pending.sender,
      recipient: pending.recipient,
      ...(newer?.nextSender !== undefined
        ? { nextSender: newer.nextSender }
        : canRestoreFailedIntent && pending.nextSender !== undefined
          ? { nextSender: pending.nextSender }
          : {}),
      ...(newer?.nextRecipient !== undefined
        ? { nextRecipient: newer.nextRecipient }
        : canRestoreFailedIntent && pending.nextRecipient !== undefined
          ? { nextRecipient: pending.nextRecipient }
          : {}),
    };
    if (hasChanges(restored)) {
      this.pendingByTarget.set(pending.targetKey, restored);
      return {
        canceledPending: null,
        retryPending: restored,
      };
    }

    this.pendingByTarget.delete(pending.targetKey);
    return {
      canceledPending: restored,
      retryPending: null,
    };
  }

  preservePendingIntent(targetKey: string, updated: Letter): Letter {
    const pending = this.pendingByTarget.get(targetKey);
    if (!pending) return updated;
    return {
      ...updated,
      metadata: {
        ...updated.metadata,
        ...(pending.nextSender !== undefined
          ? { sender: pending.nextSender ?? '' }
          : {}),
        ...(pending.nextRecipient !== undefined
          ? { recipient: pending.nextRecipient ?? '' }
          : {}),
      },
    };
  }

  hasPending(targetKey: string): boolean {
    return this.pendingByTarget.has(targetKey);
  }

  cancel(targetKey: string): void {
    this.pendingByTarget.delete(targetKey);
  }

  finish(transaction: IdentityTransaction): void {
    const { pending } = transaction;
    const active = this.activeBaselineByTarget.get(pending.targetKey);
    if (active?.generation === pending.generation) {
      this.activeBaselineByTarget.delete(pending.targetKey);
    }
  }

  private rebasePending(
    targetKey: string,
    baseline: IdentityBaseline,
  ): AcceptIdentityResult {
    const newer = this.pendingByTarget.get(targetKey);
    if (!newer) return { canceledPending: null };
    const rebased: PendingIdentityUpdate = {
      ...newer,
      primarySourceRevision: baseline.primarySourceRevision,
      sender: baseline.sender,
      recipient: baseline.recipient,
    };
    if (hasChanges(rebased)) {
      this.pendingByTarget.set(targetKey, rebased);
      return { canceledPending: null };
    }

    this.pendingByTarget.delete(targetKey);
    return { canceledPending: rebased };
  }
}
