import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findOrCreateCollectionMock,
  findOrCreateLetterMock,
  findOrCreatePageMock,
  storeFileMock,
} = vi.hoisted(() => ({
  findOrCreateCollectionMock: vi.fn(),
  findOrCreateLetterMock: vi.fn(),
  findOrCreatePageMock: vi.fn(),
  storeFileMock: vi.fn(),
}));

vi.mock('../collections.js', () => ({
  findOrCreateCollection: findOrCreateCollectionMock,
}));

vi.mock('../letters.js', () => ({
  findOrCreateLetter: findOrCreateLetterMock,
}));

vi.mock('../letter-pages.js', () => ({
  findOrCreatePage: findOrCreatePageMock,
}));

vi.mock('../storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage.js')>();
  return {
    ...actual,
    storeFile: storeFileMock,
  };
});

import { processUploadedFile, processUploadedFiles } from '../upload.js';

describe('upload service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    findOrCreateCollectionMock.mockResolvedValue({
      id: 'collection-1',
      collectionCode: '003',
    });
    findOrCreateLetterMock.mockResolvedValue({
      id: 'letter-1',
    });
    findOrCreatePageMock.mockResolvedValue({
      page: { id: 'page-1' },
      changed: true,
    });
    storeFileMock.mockResolvedValue({
      storagePath: 'storage/collections/003/19320706/L01/003-19320706-L01-01.jpg',
      checksumSha256: 'abc123',
      alreadyExists: false,
    });
  });

  it('rejects invalid filenames before touching downstream services', async () => {
    await expect(processUploadedFile('/tmp/test.jpg', 'not-a-valid-name.jpg')).rejects.toThrow(
      'Invalid filename format',
    );

    expect(findOrCreateCollectionMock).not.toHaveBeenCalled();
    expect(storeFileMock).not.toHaveBeenCalled();
  });

  it('creates collection, letter, page, and storage records for valid files', async () => {
    const result = await processUploadedFile('/tmp/test.jpg', '003-19320706-L01-01.jpg');

    expect(findOrCreateCollectionMock).toHaveBeenCalledWith('003');
    expect(findOrCreateLetterMock).toHaveBeenCalledWith({
      collectionId: 'collection-1',
      dateRaw: '19320706',
      type: 'L',
      typeSequence: 1,
      letterDate: '1932-07-06',
      dateConfidence: 'exact',
    });
    expect(storeFileMock).toHaveBeenCalledWith(
      '/tmp/test.jpg',
      expect.stringContaining('storage/collections/003/19320706/L01/003-19320706-L01-01.jpg'),
      false,
    );
    expect(findOrCreatePageMock).toHaveBeenCalledWith(
      {
        letterId: 'letter-1',
        pageNumber: 1,
        storagePath: 'storage/collections/003/19320706/L01/003-19320706-L01-01.jpg',
        originalFilename: '003-19320706-L01-01.jpg',
        checksumSha256: 'abc123',
        force: false,
      },
      { extraContentSource: undefined },
    );
    expect(result).toMatchObject({
      collection: { id: 'collection-1' },
      letter: { id: 'letter-1' },
      page: { id: 'page-1' },
      alreadyExists: false,
    });
  });

  it.each(['T', 'C', 'E'])(
    'passes the %s correspondence identity to the transactional page boundary',
    async (type) => {
      await processUploadedFile('/tmp/test.jpg', `003-19320706-${type}01-01.jpg`);

      expect(findOrCreatePageMock).toHaveBeenCalledWith(
        expect.any(Object),
        {
          extraContentSource: {
            collectionId: 'collection-1',
            dateRaw: '19320706',
            typeSequence: 1,
          },
        },
      );
    },
  );

  it('passes through force mode to storage and page updates', async () => {
    await processUploadedFile('/tmp/test.jpg', '003-19320706-L01-01.jpg', true);

    expect(storeFileMock).toHaveBeenCalledWith(
      '/tmp/test.jpg',
      expect.any(String),
      true,
    );
    expect(findOrCreatePageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
      }),
      { extraContentSource: undefined },
    );
  });

  it('collects per-file errors during batch processing', async () => {
    const singleFileError = new Error('File too small');
    storeFileMock
      .mockResolvedValueOnce({
        storagePath: 'storage/collections/003/19320706/L01/003-19320706-L01-01.jpg',
        checksumSha256: 'abc123',
        alreadyExists: false,
      })
      .mockRejectedValueOnce(singleFileError);

    const result = await processUploadedFiles([
      { tempPath: '/tmp/ok.jpg', originalFilename: '003-19320706-L01-01.jpg' },
      { tempPath: '/tmp/bad.jpg', originalFilename: '003-19320706-L01-02.jpg' },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.errors).toEqual([
      {
        filename: '003-19320706-L01-02.jpg',
        error: 'File too small',
      },
    ]);
  });
});
