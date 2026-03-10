import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '../../../api/client';

const {
  showToastMock,
  getProcessingQueueMock,
  startTranscriptionMock,
  startMetadataExtractionMock,
  startEntityExtractionMock,
  pauseProcessingMock,
  resumeProcessingMock,
  abortProcessingMock,
  removeFromQueueMock,
  clearQueueMock,
  retryFailedMock,
  cancelActiveJobMock,
} = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  getProcessingQueueMock: vi.fn(),
  startTranscriptionMock: vi.fn(),
  startMetadataExtractionMock: vi.fn(),
  startEntityExtractionMock: vi.fn(),
  pauseProcessingMock: vi.fn(),
  resumeProcessingMock: vi.fn(),
  abortProcessingMock: vi.fn(),
  removeFromQueueMock: vi.fn(),
  clearQueueMock: vi.fn(),
  retryFailedMock: vi.fn(),
  cancelActiveJobMock: vi.fn(),
}));

vi.mock('../../../api/admin', () => ({
  getProcessingQueue: getProcessingQueueMock,
  startTranscription: startTranscriptionMock,
  startMetadataExtraction: startMetadataExtractionMock,
  startEntityExtraction: startEntityExtractionMock,
  pauseProcessing: pauseProcessingMock,
  resumeProcessing: resumeProcessingMock,
  abortProcessing: abortProcessingMock,
  removeFromQueue: removeFromQueueMock,
  clearQueue: clearQueueMock,
  retryFailed: retryFailedMock,
  cancelActiveJob: cancelActiveJobMock,
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: showToastMock,
  }),
}));

vi.mock('../../../components/AdminLayout/AdminLayout', () => ({
  default: ({
    children,
    headerActions,
  }: {
    children: ReactNode;
    headerActions?: ReactNode;
  }) => (
    <div>
      <div>{headerActions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('../../../components/common', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

import ProcessingQueuePage from '../ProcessingQueuePage';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function createQueueStatus() {
  return {
    counts: {
      activeCount: 1,
      queuedTranscription: 1,
      queuedMetadata: 0,
      queuedEntityExtraction: 0,
      recentSuccessCount: 1,
      recentFailedCount: 1,
    },
    active: [
      {
        letterId: 'letter-1',
        collectionCode: '009',
        type: 'transcription',
        startedAt: '2026-03-09T12:00:00.000Z',
        letterTitle: '19470810',
        sender: 'Alice',
        recipient: 'Bob',
        progress: {
          step: 1,
          totalSteps: 3,
          stepLabel: 'OCR',
        },
      },
    ],
    queued: {
      transcription: [
        {
          letterId: 'letter-2',
          collectionCode: '009',
          letterTitle: '19470811',
          sender: 'Cara',
          recipient: 'Dan',
          queuedAt: '2026-03-09T12:01:00.000Z',
        },
      ],
      metadata: [],
      entityExtraction: [],
    },
    recent: [
      {
        letterId: 'letter-3',
        collectionCode: '009',
        letterTitle: '19470812',
        type: 'metadata',
        status: 'FAILED',
        completedAt: '2026-03-09T12:02:00.000Z',
        error: 'metadata offline',
      },
    ],
    onDemandProcessing: {
      isRunning: false,
      isPaused: false,
      total: 0,
      completed: 0,
      errors: [],
    },
  };
}

describe('ProcessingQueuePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getProcessingQueueMock.mockResolvedValue(createQueueStatus());
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders queue data after the initial load', async () => {
    render(<ProcessingQueuePage />);

    expect(await screen.findByText('Processing Queue')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Transcription (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows an unavailable state when the queue fetch fails', async () => {
    getProcessingQueueMock.mockRejectedValueOnce(
      new ApiError(503, 'queue down', undefined, 'req-queue-load-503'),
    );

    render(<ProcessingQueuePage />);

    expect(await screen.findByText('Unable to load queue status')).toBeInTheDocument();
    expect(showToastMock).toHaveBeenCalledWith(
      'queue down (Request ID: req-queue-load-503)',
      'error',
    );
  });

  it('includes request ids in operator toasts when queue actions fail', async () => {
    const user = userEvent.setup();
    cancelActiveJobMock.mockRejectedValueOnce(
      new ApiError(500, 'Job queue stalled', undefined, 'req-queue-123'),
    );

    render(<ProcessingQueuePage />);

    await screen.findByText('Processing Queue');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(showToastMock).toHaveBeenCalledWith(
        'Job queue stalled (Request ID: req-queue-123)',
        'error',
      );
    });
  });
});
