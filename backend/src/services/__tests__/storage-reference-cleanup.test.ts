import { describe, expect, it, vi } from 'vitest';
import {
  reclaimUnreferencedPageStoragePath,
  type PageStorageReclamationResult,
} from '../storage-reference-cleanup.js';

const expectedResults = {
  legacyRetained: 'legacy-path-retained',
  stillReferenced: 'still-referenced',
  removed: 'removed',
  alreadyMissing: 'already-missing',
} as const satisfies Record<string, PageStorageReclamationResult>;

const immutablePath =
  'storage/collections/009/19470810/L01/objects/'
  + '009-19470810-L01-01/'
  + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  + '-54000000-0000-4000-8000-000000000099.jpg';

describe('storage reference cleanup', () => {
  it.each([
    'storage/collections/009/19470810/L01/009-19470810-L01-01.jpg',
    'storage/collections/009/19470810/L01/objects/page/shared-id.jpg',
    'storage/collections/009/19470810/L01/objects/page/'
      + 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      + '-not-a-uuid.jpg',
  ])(
    'retains the non-immutable path %s without querying or unlinking it',
    async (storagePath) => {
      const findPageReference = vi.fn();
      const removeFile = vi.fn();

      await expect(reclaimUnreferencedPageStoragePath(
        storagePath,
        { findPageReference, removeFile },
      )).resolves.toBe(expectedResults.legacyRetained);

      expect(findPageReference).not.toHaveBeenCalled();
      expect(removeFile).not.toHaveBeenCalled();
    },
  );

  it('retains an immutable path that an exact current page reference still owns', async () => {
    const findPageReference = vi.fn().mockResolvedValue({ id: 'surviving-page' });
    const removeFile = vi.fn();

    await expect(reclaimUnreferencedPageStoragePath(
      immutablePath,
      { findPageReference, removeFile },
    )).resolves.toBe(expectedResults.stillReferenced);

    expect(findPageReference).toHaveBeenCalledOnce();
    expect(findPageReference).toHaveBeenCalledWith(immutablePath);
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('removes an immutable path after its exact reference check finds no owner', async () => {
    const findPageReference = vi.fn().mockResolvedValue(null);
    const removeFile = vi.fn().mockResolvedValue(undefined);

    await expect(reclaimUnreferencedPageStoragePath(
      immutablePath,
      { findPageReference, removeFile },
    )).resolves.toBe(expectedResults.removed);

    expect(findPageReference).toHaveBeenCalledOnce();
    expect(findPageReference).toHaveBeenCalledWith(immutablePath);
    expect(removeFile).toHaveBeenCalledOnce();
    expect(removeFile).toHaveBeenCalledWith(immutablePath);
  });

  it('treats an already-missing immutable object as successful cleanup', async () => {
    const findPageReference = vi.fn().mockResolvedValue(null);
    const removeFile = vi.fn().mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );

    await expect(reclaimUnreferencedPageStoragePath(
      immutablePath,
      { findPageReference, removeFile },
    )).resolves.toBe(expectedResults.alreadyMissing);

    expect(removeFile).toHaveBeenCalledWith(immutablePath);
  });

  it('does not unlink and rejects when the exact reference query fails', async () => {
    const databaseError = new Error('database unavailable');
    const findPageReference = vi.fn().mockRejectedValue(databaseError);
    const removeFile = vi.fn();

    await expect(reclaimUnreferencedPageStoragePath(
      immutablePath,
      { findPageReference, removeFile },
    )).rejects.toBe(databaseError);

    expect(removeFile).not.toHaveBeenCalled();
  });

  it('rejects a non-ENOENT unlink failure for the caller to handle', async () => {
    const filesystemError = Object.assign(
      new Error('filesystem unavailable'),
      { code: 'EIO' },
    );
    const findPageReference = vi.fn().mockResolvedValue(null);
    const removeFile = vi.fn().mockRejectedValue(filesystemError);

    await expect(reclaimUnreferencedPageStoragePath(
      immutablePath,
      { findPageReference, removeFile },
    )).rejects.toBe(filesystemError);
  });
});
