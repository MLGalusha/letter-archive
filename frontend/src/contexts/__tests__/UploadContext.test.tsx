import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';

const { showToastMock, uploadFilesMock } = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  uploadFilesMock: vi.fn(),
}));

vi.mock('../../api/admin', () => ({
  uploadFiles: uploadFilesMock,
}));

vi.mock('../ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

import {
  UploadProvider,
  useUpload,
} from '../UploadContext';

const expectation = {
  pageId: 'page-1',
  primarySourceRevision: 7,
  storagePath: 'storage/current.jpg',
  checksumSha256: 'checksum-current',
};

function wrapper({ children }: { children: ReactNode }) {
  return <UploadProvider>{children}</UploadProvider>;
}

describe('UploadProvider source-conflict ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadFilesMock.mockResolvedValue({
      success: 1,
      failed: 0,
      results: [{
        filename: '009-19470810-L01-01.jpg',
        letterId: 'letter-1',
        pageId: 'page-1',
        collectionCode: '009',
        storagePath: 'storage/replaced.jpg',
        primarySourceRevision: 8,
        alreadyExists: true,
        outcome: 'replaced',
        changed: true,
      }],
      errors: [],
      summary: {
        accepted: 1,
        failed: 0,
        changed: 1,
        unchanged: 0,
        created: 0,
        replaced: 1,
        affectedLetters: 1,
      },
    });
  });

  it('carries a committed successor revision across force files in one correspondence', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const secondExpectation = {
      ...expectation,
      pageId: 'page-2',
    };

    act(() => result.current.startUpload([
      {
        file: new File(['a'], '009-19470810-L01-01.jpg'),
        force: true,
        sourceExpectation: expectation,
      },
      {
        file: new File(['b'], '009-19470810-L01-02.jpg'),
        force: true,
        sourceExpectation: secondExpectation,
      },
    ]));

    await waitFor(() => expect(uploadFilesMock).toHaveBeenCalledTimes(2));
    expect(uploadFilesMock.mock.calls[0]?.slice(1)).toEqual([
      true,
      { '009-19470810-L01-01.jpg': expectation },
    ]);
    expect(uploadFilesMock.mock.calls[1]?.slice(1)).toEqual([
      true,
      {
        '009-19470810-L01-02.jpg': {
          ...secondExpectation,
          primarySourceRevision: 8,
        },
      },
    ]);
  });

  it('carries a new-page batch successor into a later force replacement', async () => {
    const newFilename = '009-19470810-L01-03.jpg';
    const replacementFilename = '009-19470810-L01-01.jpg';
    uploadFilesMock
      .mockResolvedValueOnce({
        success: 1,
        failed: 0,
        results: [{
          filename: newFilename,
          letterId: 'letter-1',
          pageId: 'page-3',
          collectionCode: '009',
          storagePath: 'storage/new-page.jpg',
          primarySourceRevision: 8,
          alreadyExists: false,
          outcome: 'created',
          changed: true,
        }],
        errors: [],
        summary: {
          accepted: 1,
          failed: 0,
          changed: 1,
          unchanged: 0,
          created: 1,
          replaced: 0,
          affectedLetters: 1,
        },
      })
      .mockResolvedValueOnce({
        success: 1,
        failed: 0,
        results: [{
          filename: replacementFilename,
          letterId: 'letter-1',
          pageId: 'page-1',
          collectionCode: '009',
          storagePath: 'storage/replaced.jpg',
          primarySourceRevision: 9,
          alreadyExists: true,
          outcome: 'replaced',
          changed: true,
        }],
        errors: [],
        summary: {
          accepted: 1,
          failed: 0,
          changed: 1,
          unchanged: 0,
          created: 0,
          replaced: 1,
          affectedLetters: 1,
        },
      });
    const { result } = renderHook(() => useUpload(), { wrapper });

    act(() => result.current.startUpload([
      {
        file: new File(['new'], newFilename),
        force: false,
        sourceExpectation: null,
      },
      {
        file: new File(['replacement'], replacementFilename),
        force: true,
        sourceExpectation: expectation,
      },
    ]));

    await waitFor(() => expect(uploadFilesMock).toHaveBeenCalledTimes(2));
    expect(uploadFilesMock.mock.calls[0]?.slice(1)).toEqual([
      false,
      undefined,
    ]);
    expect(uploadFilesMock.mock.calls[1]?.slice(1)).toEqual([
      true,
      {
        [replacementFilename]: {
          ...expectation,
          primarySourceRevision: 8,
        },
      },
    ]);
  });

  it('does not carry a successor revision into another correspondence', async () => {
    const { result } = renderHook(() => useUpload(), { wrapper });
    const otherExpectation = {
      ...expectation,
      pageId: 'page-other',
    };

    act(() => result.current.startUpload([
      {
        file: new File(['a'], '009-19470810-L01-01.jpg'),
        force: true,
        sourceExpectation: expectation,
      },
      {
        file: new File(['b'], '009-19470811-L01-01.jpg'),
        force: true,
        sourceExpectation: otherExpectation,
      },
    ]));

    await waitFor(() => expect(uploadFilesMock).toHaveBeenCalledTimes(2));
    expect(uploadFilesMock.mock.calls[1]?.slice(1)).toEqual([
      true,
      { '009-19470811-L01-01.jpg': otherExpectation },
    ]);
  });

  it('does not adopt another writer revision from an unchanged upload', async () => {
    const observedFilename = '009-19470810-L01-03.jpg';
    const replacementFilename = '009-19470810-L01-01.jpg';
    uploadFilesMock.mockResolvedValueOnce({
      success: 1,
      failed: 0,
      results: [{
        filename: observedFilename,
        letterId: 'letter-1',
        pageId: 'page-3',
        collectionCode: '009',
        storagePath: 'storage/concurrent-page.jpg',
        primarySourceRevision: 8,
        alreadyExists: true,
        outcome: 'unchanged',
        changed: false,
      }],
      errors: [],
      summary: {
        accepted: 1,
        failed: 0,
        changed: 0,
        unchanged: 1,
        created: 0,
        replaced: 0,
        affectedLetters: 0,
      },
    });
    const { result } = renderHook(() => useUpload(), { wrapper });

    act(() => result.current.startUpload([
      {
        file: new File(['observed'], observedFilename),
        force: false,
        sourceExpectation: null,
      },
      {
        file: new File(['replacement'], replacementFilename),
        force: true,
        sourceExpectation: expectation,
      },
    ]));

    await waitFor(() => expect(uploadFilesMock).toHaveBeenCalledTimes(2));
    expect(uploadFilesMock.mock.calls[1]?.slice(1)).toEqual([
      true,
      { [replacementFilename]: expectation },
    ]);
  });

  it('centrally classifies and preserves a stale force error', async () => {
    uploadFilesMock.mockRejectedValueOnce(new ApiError(
      409,
      'Page source changed',
      { code: 'SOURCE_REVISION_CHANGED' },
    ));
    const { result } = renderHook(() => useUpload(), { wrapper });

    act(() => result.current.startUpload([{
      file: new File(['a'], '009-19470810-L01-01.jpg'),
      force: true,
      sourceExpectation: expectation,
    }]));

    await waitFor(() => expect(result.current.job?.status).toBe('complete'));
    expect(result.current.job?.errors).toEqual([expect.objectContaining({
      filename: '009-19470810-L01-01.jpg',
      code: 'SOURCE_REVISION_CHANGED',
    })]);
    expect(showToastMock).toHaveBeenCalledWith(
      expect.stringContaining('file was kept'),
      'error',
    );
  });
});
