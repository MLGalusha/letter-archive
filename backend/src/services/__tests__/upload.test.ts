import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findOrCreateCollectionMock,
  findOrCreateLetterMock,
  findOrCreatePageMock,
  getPageMock,
  computeChecksumMock,
  inspectUploadFileMock,
  removeStoredFileMock,
  storeImmutableFileMock,
} = vi.hoisted(() => ({
  findOrCreateCollectionMock: vi.fn(),
  findOrCreateLetterMock: vi.fn(),
  findOrCreatePageMock: vi.fn(),
  getPageMock: vi.fn(),
  computeChecksumMock: vi.fn(),
  inspectUploadFileMock: vi.fn(),
  removeStoredFileMock: vi.fn(),
  storeImmutableFileMock: vi.fn(),
}));

vi.mock('../collections.js', () => ({
  findOrCreateCollection: findOrCreateCollectionMock,
}));

vi.mock('../letters.js', () => ({
  findOrCreateLetter: findOrCreateLetterMock,
}));

vi.mock('../letter-pages.js', () => ({
  findOrCreatePage: findOrCreatePageMock,
  getPage: getPageMock,
}));

vi.mock('../storage.js', () => ({
  buildStoragePath: vi.fn((
    _collectionCode: string,
    _dateRaw: string,
    _type: string,
    _typeSequence: number,
    originalFilename: string,
  ) => `storage/${originalFilename}`),
  computeChecksum: computeChecksumMock,
  getAbsoluteStoragePath: vi.fn((path: string) => path),
  inspectUploadFile: inspectUploadFileMock,
  isImmutableStoragePath: vi.fn((storagePath: string) => (
    storagePath.includes('/objects/')
  )),
  removeStoredFile: removeStoredFileMock,
  storeImmutableFile: storeImmutableFileMock,
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn().mockResolvedValue({ width: 1200, height: 1800 }),
  })),
}));

import { processUploadedFile } from '../upload.js';
import { sourceRevisionChanged } from '../letter/source-revision.js';

function replacementExpectation(page: {
  id: string;
  storagePath: string;
  checksumSha256: string | null;
}) {
  return {
    pageId: page.id,
    primarySourceRevision: 7,
    storagePath: page.storagePath,
    checksumSha256: page.checksumSha256,
  };
}

describe('upload service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findOrCreateCollectionMock.mockResolvedValue({
      id: 'collection-1',
      collectionCode: '003',
    });
    findOrCreateLetterMock.mockResolvedValue({ id: 'letter-1' });
    getPageMock.mockResolvedValue(undefined);
    findOrCreatePageMock.mockResolvedValue({
      page: { id: 'page-1', storagePath: 'storage/objects/source-a.jpg' },
      outcome: 'created',
      sourceChanged: true,
      primarySourceRevision: 1,
    });
    inspectUploadFileMock.mockResolvedValue({
      checksumSha256: 'abc123',
      sizeBytes: 20_000,
    });
    storeImmutableFileMock.mockResolvedValue({
      storagePath: 'storage/objects/source-a.jpg',
      checksumSha256: 'abc123',
    });
    computeChecksumMock.mockResolvedValue('abc123');
    removeStoredFileMock.mockResolvedValue(undefined);
  });

  it('rejects invalid filenames before touching downstream services', async () => {
    await expect(processUploadedFile('/tmp/test.jpg', 'not-a-valid-name.jpg')).rejects.toThrow(
      'Invalid filename format',
    );

    expect(findOrCreateCollectionMock).not.toHaveBeenCalled();
    expect(storeImmutableFileMock).not.toHaveBeenCalled();
  });

  it('creates collection, letter, immutable source, and primary page records', async () => {
    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    );

    expect(findOrCreateCollectionMock).toHaveBeenCalledWith('003');
    expect(findOrCreateLetterMock).toHaveBeenCalledWith({
      collectionId: 'collection-1',
      dateRaw: '19320706',
      type: 'L',
      typeSequence: 1,
      letterDate: '1932-07-06',
      dateConfidence: 'exact',
    });
    expect(storeImmutableFileMock).toHaveBeenCalledWith(
      '/tmp/test.jpg',
      'storage/003-19320706-L01-01.jpg',
      'abc123',
    );
    expect(findOrCreatePageMock).toHaveBeenCalledWith(
      {
        collectionId: 'collection-1',
        letterId: 'letter-1',
        pageNumber: 1,
        storagePath: 'storage/objects/source-a.jpg',
        originalFilename: '003-19320706-L01-01.jpg',
        checksumSha256: 'abc123',
        width: 1200,
        height: 1800,
        existingPagePolicy: 'keep',
      },
    );
    expect(result).toMatchObject({
      collection: { id: 'collection-1' },
      letter: { id: 'letter-1' },
      page: { id: 'page-1' },
      primarySourceRevision: 1,
      alreadyExists: false,
      outcome: 'created',
      changed: true,
    });
  });

  it.each(['T', 'C', 'E'])(
    'commits %s pages through the canonical page boundary',
    async (type) => {
      await processUploadedFile('/tmp/test.jpg', `003-19320706-${type}01-01.jpg`);

      expect(findOrCreatePageMock).toHaveBeenCalledWith(
        expect.objectContaining({ collectionId: 'collection-1' }),
      );
    },
  );

  it('replaces a different committed source in force mode', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/current.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'old-checksum',
    };
    getPageMock.mockResolvedValue(existing);
    computeChecksumMock.mockResolvedValue('old-checksum');
    findOrCreatePageMock.mockResolvedValue({
      page: { id: 'page-existing', storagePath: 'storage/objects/source-a.jpg' },
      outcome: 'replaced',
      sourceChanged: true,
      primarySourceRevision: 8,
    });

    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
      true,
      replacementExpectation(existing),
    );

    expect(findOrCreatePageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        existingPagePolicy: 'replace',
        expectedReplacementSource: replacementExpectation(existing),
      }),
    );
    expect(result).toMatchObject({
      primarySourceRevision: 8,
      outcome: 'replaced',
      changed: true,
      alreadyExists: true,
    });
  });

  it('returns a truthful unchanged outcome without staging a non-force duplicate', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/current.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    getPageMock.mockResolvedValue(existing);
    findOrCreatePageMock.mockResolvedValueOnce({
      page: existing,
      outcome: 'unchanged',
      sourceChanged: false,
    });

    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    );

    expect(result).toMatchObject({
      page: existing,
      outcome: 'unchanged',
      changed: false,
      alreadyExists: true,
    });
    expect(storeImmutableFileMock).not.toHaveBeenCalled();
    expect(findOrCreatePageMock).toHaveBeenCalledWith(expect.objectContaining({
      storagePath: existing.storagePath,
      checksumSha256: existing.checksumSha256,
      existingPagePolicy: 'keep',
      expectedExistingSource: {
        storagePath: existing.storagePath,
        checksumSha256: existing.checksumSha256,
      },
    }));
  });

  it('returns the current winner when a non-force no-op races a replacement', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/current.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    const winner = {
      ...existing,
      storagePath: 'storage/objects/current/winner.jpg',
      checksumSha256: 'winner-checksum',
    };
    getPageMock.mockResolvedValue(existing);
    findOrCreatePageMock.mockResolvedValueOnce({
      page: winner,
      outcome: 'unchanged',
      sourceChanged: false,
    });

    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    );

    expect(result).toMatchObject({
      page: winner,
      storagePath: winner.storagePath,
      outcome: 'unchanged',
      changed: false,
    });
  });

  it('does not report a missing page with no committed checksum as unchanged', async () => {
    getPageMock.mockResolvedValue({
      id: 'page-existing',
      storagePath: 'storage/missing.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: null,
    });
    computeChecksumMock.mockRejectedValueOnce(new Error('missing'));

    await expect(processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    )).rejects.toThrow('committed page file is missing');

    expect(findOrCreatePageMock).not.toHaveBeenCalled();
    expect(storeImmutableFileMock).not.toHaveBeenCalled();
  });

  it('repairs a missing committed object when the upload matches its checksum', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/missing.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    getPageMock.mockResolvedValue(existing);
    computeChecksumMock.mockRejectedValueOnce(new Error('missing'));
    findOrCreatePageMock.mockResolvedValueOnce({
      page: { ...existing, storagePath: 'storage/objects/source-a.jpg' },
      outcome: 'relocated',
      sourceChanged: false,
      previousStoragePath: existing.storagePath,
    });

    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    );

    expect(storeImmutableFileMock).toHaveBeenCalledWith(
      '/tmp/test.jpg',
      'storage/003-19320706-L01-01.jpg',
      'abc123',
    );
    expect(findOrCreatePageMock).toHaveBeenCalledWith(expect.objectContaining({
      existingPagePolicy: 'repair',
      expectedExistingSource: {
        storagePath: existing.storagePath,
        checksumSha256: existing.checksumSha256,
      },
    }));
    expect(result).toMatchObject({ outcome: 'unchanged', changed: false });
  });

  it('removes an unused candidate after a fenced non-force commit loses', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/missing.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    const winner = {
      ...existing,
      storagePath: 'storage/objects/winner/source-b.jpg',
      checksumSha256: 'winner-checksum',
    };
    getPageMock.mockResolvedValue(existing);
    computeChecksumMock.mockRejectedValueOnce(new Error('missing'));
    findOrCreatePageMock.mockResolvedValueOnce({
      page: winner,
      outcome: 'unchanged',
      sourceChanged: false,
    });

    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    );

    expect(removeStoredFileMock).toHaveBeenCalledWith(
      'storage/objects/source-a.jpg',
    );
    expect(result).toMatchObject({
      page: winner,
      storagePath: winner.storagePath,
      outcome: 'unchanged',
      changed: false,
    });
  });

  it('rematerializes drifted live bytes instead of blessing unrelated upload bytes', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/drifted.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'committed-checksum',
    };
    getPageMock.mockResolvedValue(existing);
    computeChecksumMock.mockResolvedValueOnce('actual-drift-checksum');
    inspectUploadFileMock.mockResolvedValueOnce({
      checksumSha256: 'unrelated-upload-checksum',
      sizeBytes: 20_000,
    });
    storeImmutableFileMock.mockResolvedValueOnce({
      storagePath: 'storage/objects/drifted-source.jpg',
      checksumSha256: 'actual-drift-checksum',
    });
    findOrCreatePageMock.mockResolvedValueOnce({
      page: {
        ...existing,
        storagePath: 'storage/objects/drifted-source.jpg',
        checksumSha256: 'actual-drift-checksum',
      },
      outcome: 'replaced',
      sourceChanged: true,
    });

    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.png',
    );

    expect(storeImmutableFileMock).toHaveBeenCalledWith(
      existing.storagePath,
      existing.storagePath,
      'actual-drift-checksum',
    );
    expect(findOrCreatePageMock).toHaveBeenCalledWith(expect.objectContaining({
      originalFilename: existing.originalFilename,
      existingPagePolicy: 'invalidate',
      expectedExistingSource: {
        storagePath: existing.storagePath,
        checksumSha256: existing.checksumSha256,
      },
    }));
    expect(result).toMatchObject({ outcome: 'replaced', changed: true });
  });

  it('refuses to bless checksum drift on an already-immutable object', async () => {
    const expectedChecksum = 'a'.repeat(64);
    const existing = {
      id: 'page-existing',
      storagePath:
        `storage/collections/003/19320706/L01/objects/003-19320706-L01-01/`
        + `${expectedChecksum}-54000000-0000-4000-8000-000000000099.jpg`,
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: expectedChecksum,
    };
    getPageMock.mockResolvedValue(existing);
    computeChecksumMock.mockResolvedValueOnce('corrupt-object-checksum');
    inspectUploadFileMock.mockResolvedValueOnce({
      checksumSha256: 'unrelated-upload-checksum',
      sizeBytes: 20_000,
    });

    await expect(processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    )).rejects.toThrow('immutable page object failed checksum verification');

    expect(storeImmutableFileMock).not.toHaveBeenCalled();
    expect(findOrCreatePageMock).not.toHaveBeenCalled();
  });

  it('does not stage or invalidate when force receives the committed bytes again', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/current.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    getPageMock.mockResolvedValue(existing);
    findOrCreatePageMock.mockResolvedValueOnce({
      page: existing,
      outcome: 'unchanged',
      sourceChanged: false,
    });

    const result = await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
      true,
      replacementExpectation(existing),
    );

    expect(storeImmutableFileMock).not.toHaveBeenCalled();
    expect(findOrCreatePageMock).toHaveBeenCalledWith(expect.objectContaining({
      storagePath: existing.storagePath,
      checksumSha256: existing.checksumSha256,
      existingPagePolicy: 'replace',
      expectedReplacementSource: replacementExpectation(existing),
    }));
    expect(findOrCreatePageMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'expectedExistingSource',
    );
    expect(result).toMatchObject({ outcome: 'unchanged', changed: false });
  });

  it('rejects a force no-op when the canonical transaction observes a newer source', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/current.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    getPageMock.mockResolvedValue(existing);
    findOrCreatePageMock.mockRejectedValueOnce(sourceRevisionChanged(
      'Page source changed after duplicate confirmation',
    ));

    await expect(processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
      true,
      replacementExpectation(existing),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(storeImmutableFileMock).not.toHaveBeenCalled();
    expect(findOrCreatePageMock).toHaveBeenCalledWith(expect.objectContaining({
      existingPagePolicy: 'replace',
      expectedReplacementSource: replacementExpectation(existing),
    }));
  });

  it('force-repairs a missing object and still wins a replacement at commit time', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/missing.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    getPageMock.mockResolvedValue(existing);
    computeChecksumMock.mockRejectedValueOnce(new Error('missing'));
    findOrCreatePageMock.mockResolvedValueOnce({
      page: { ...existing, storagePath: 'storage/objects/source-a.jpg' },
      outcome: 'relocated',
      sourceChanged: false,
    });

    await processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
      true,
      replacementExpectation(existing),
    );

    expect(findOrCreatePageMock).toHaveBeenCalledWith(expect.objectContaining({
      existingPagePolicy: 'reconcile',
      expectedReplacementSource: replacementExpectation(existing),
    }));
    expect(findOrCreatePageMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'expectedExistingSource',
    );
  });

  it('requires duplicate-check ownership before force replacement', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/current.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
    };
    getPageMock.mockResolvedValue(existing);

    await expect(processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
      true,
    )).rejects.toThrow('requires the source expectation');

    expect(inspectUploadFileMock).not.toHaveBeenCalled();
    expect(storeImmutableFileMock).not.toHaveBeenCalled();
    expect(findOrCreatePageMock).not.toHaveBeenCalled();
  });

  it('rejects a stale confirmation before staging when the page pointer already changed', async () => {
    const observed = {
      id: 'page-existing',
      storagePath: 'storage/observed.jpg',
      checksumSha256: 'observed-checksum',
    };
    getPageMock.mockResolvedValue({
      ...observed,
      storagePath: 'storage/winner.jpg',
      checksumSha256: 'winner-checksum',
    });

    await expect(processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
      true,
      replacementExpectation(observed),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(inspectUploadFileMock).not.toHaveBeenCalled();
    expect(storeImmutableFileMock).not.toHaveBeenCalled();
    expect(findOrCreatePageMock).not.toHaveBeenCalled();
  });

  it('removes a prepared force candidate when the locked source epoch is stale', async () => {
    const existing = {
      id: 'page-existing',
      storagePath: 'storage/current.jpg',
      originalFilename: '003-19320706-L01-01.jpg',
      checksumSha256: 'old-checksum',
    };
    getPageMock.mockResolvedValue(existing);
    computeChecksumMock.mockResolvedValue('old-checksum');
    findOrCreatePageMock.mockRejectedValueOnce(sourceRevisionChanged(
      'Page source changed after duplicate confirmation',
    ));

    await expect(processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
      true,
      replacementExpectation(existing),
    )).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(storeImmutableFileMock).toHaveBeenCalledOnce();
    expect(removeStoredFileMock).toHaveBeenCalledWith(
      'storage/objects/source-a.jpg',
    );
  });

  it('retains an immutable candidate and reports database reconciliation failure', async () => {
    findOrCreatePageMock.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(processUploadedFile(
      '/tmp/test.jpg',
      '003-19320706-L01-01.jpg',
    )).rejects.toThrow('database reconciliation failed');

    expect(removeStoredFileMock).not.toHaveBeenCalled();
  });
});
