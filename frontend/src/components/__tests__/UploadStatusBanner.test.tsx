import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clearJobMock, useUploadMock } = vi.hoisted(() => ({
  clearJobMock: vi.fn(),
  useUploadMock: vi.fn(),
}));

vi.mock('../../contexts/UploadContext', () => ({
  useUpload: useUploadMock,
}));

import UploadStatusBanner from '../UploadStatusBanner';

function result(
  filename: string,
  outcome: 'created' | 'replaced' | 'unchanged',
) {
  return {
    filename,
    letterId: `letter-${filename}`,
    pageId: `page-${filename}`,
    collectionCode: '009',
    storagePath: `storage/${filename}`,
    alreadyExists: outcome !== 'created',
    outcome,
    changed: outcome !== 'unchanged',
  };
}

describe('UploadStatusBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports authoritative created, replaced, unchanged, and failed counts', () => {
    useUploadMock.mockReturnValue({
      job: {
        status: 'complete',
        files: [],
        totalFiles: 4,
        completedFiles: 4,
        successCount: 3,
        failedCount: 1,
        results: [
          result('created.jpg', 'created'),
          result('replaced.jpg', 'replaced'),
          result('unchanged.jpg', 'unchanged'),
        ],
        errors: [{ filename: 'failed.jpg', error: 'failed' }],
      },
      clearJob: clearJobMock,
    });

    render(<UploadStatusBanner />);

    expect(screen.getByText(
      'Upload complete — 1 created, 1 replaced, 1 unchanged, 1 failed',
    )).toBeInTheDocument();
  });
});
