import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type {
  ProcessingActiveJob,
  ProcessingQueueItem,
  ProcessingRecentJob,
} from '../../../api/admin/processing';
import RecentActivityList from '../ProcessingQueue/RecentActivityList';
import StageQueueSection from '../ProcessingQueue/StageQueueSection';
import { PROCESSING_STAGES } from '../ProcessingQueue/stages';

const stage = PROCESSING_STAGES[0];
const queued: ProcessingQueueItem = {
  letterId: 'queued-letter',
  primarySourceRevision: 4,
  jobStateToken: 'v1.queued-token',
  letterTitle: '19470810',
  collectionCode: '009',
  sender: 'Alice',
  recipient: 'Bob',
  queuedAt: null,
};
const active: ProcessingActiveJob = {
  ...queued,
  letterId: 'active-letter',
  jobStateToken: 'v1.active-token',
  type: 'transcription',
  startedAt: '2026-07-24T12:00:00.000Z',
};

describe('processing queue snapshot actions', () => {
  it('passes the complete displayed snapshots to remove, clear, and cancel', () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const onCancel = vi.fn();
    render(
      <MemoryRouter>
        <StageQueueSection
          stage={stage}
          queued={[queued]}
          active={[active]}
          onRemove={onRemove}
          onClear={onClear}
          onCancel={onCancel}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
    expect(onClear).toHaveBeenCalledWith(
      'transcription',
      'Transcription',
      [queued],
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith('transcription', active);

    fireEvent.click(screen.getByRole('button', {
      name: /Transcription queue/,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('transcription', queued);
  });

  it('passes the failed recent job snapshot to retry', () => {
    const recent: ProcessingRecentJob = {
      letterId: 'failed-letter',
      primarySourceRevision: 9,
      jobStateToken: 'v1.failed-token',
      letterTitle: '19470811',
      collectionCode: '009',
      type: 'metadata',
      status: 'FAILED',
      error: 'metadata unavailable',
      completedAt: '2026-07-24T12:00:00.000Z',
    };
    const onRetry = vi.fn();

    render(
      <MemoryRouter>
        <RecentActivityList recent={[recent]} onRetry={onRetry} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledWith(recent);
  });
});
