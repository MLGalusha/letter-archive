import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from '../config/env.js';
import { getAbsoluteStoragePath } from './storage.js';
import { isSavedPreviewWidth, type ImageVariantFormat } from './image-variant.js';

export const MAX_SAVED_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAGIC = Buffer.from('LAPRV001');
// Magic, representation identity, payload length, payload SHA-256, then raw bytes.
const HEADER_BYTES = 8 + 32 + 4 + 32;
// Match the deployed per-instance HTTP concurrency: ordinary warm card bursts
// should all look up saved bytes instead of being redirected to CPU transforms.
const MAX_READS = 40;
const MAX_WRITES = 2;

type ReadResult = { status: 'hit'; buffer: Buffer } | {
  status: 'miss' | 'invalid' | 'error' | 'busy' | 'unsupported';
};
type WriteResult = 'saved' | 'error' | 'busy' | 'unsupported' | 'oversized';

/** Optional, disposable storage: no error here may prevent serving a valid image. */
export class ImageVariantStore {
  private activeReads = 0;
  private activeWrites = 0;
  private writing = new Set<string>();

  constructor(private readonly root?: string) {}

  private location(identity: string, width: number, format: ImageVariantFormat): string | null {
    // Other widths still work through the original resize path without disk growth.
    if (!isSavedPreviewWidth(width) || !['avif', 'webp', 'jpeg'].includes(format) || !/^[a-f0-9]{64}$/.test(identity)) return null;
    const root = this.root ?? getAbsoluteStoragePath(env.STORAGE_DIR);
    return join(root, 'image-previews-v1', identity.slice(0, 2), `${identity}.preview`);
  }

  async read(identity: string, width: number, format: ImageVariantFormat): Promise<ReadResult> {
    if (this.activeReads >= MAX_READS) return { status: 'busy' };
    this.activeReads++;
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const path = this.location(identity, width, format);
      if (!path) return { status: 'unsupported' };
      file = await open(path, 'r');
      const { size } = await file.stat();
      if (size <= HEADER_BYTES || size > HEADER_BYTES + MAX_SAVED_PREVIEW_BYTES) return { status: 'invalid' };
      // Read at most the checked size plus one byte. A concurrently growing file
      // cannot make readFile allocate without a bound, or become a partial hit.
      const bytes = Buffer.alloc(size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== size || !bytes.subarray(0, 8).equals(MAGIC)
        || bytes.subarray(8, 40).toString('hex') !== identity
        || bytes.readUInt32BE(40) !== size - HEADER_BYTES) return { status: 'invalid' };
      const buffer = bytes.subarray(HEADER_BYTES, size);
      const digest = createHash('sha256').update(buffer).digest();
      if (!digest.equals(bytes.subarray(44, HEADER_BYTES))) return { status: 'invalid' };
      return { status: 'hit', buffer };
    } catch (error) {
      return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'miss' : 'error' };
    } finally {
      await file?.close().catch(() => {});
      this.activeReads--;
    }
  }

  async write(identity: string, width: number, format: ImageVariantFormat, buffer: Buffer): Promise<WriteResult> {
    if (!buffer.length || buffer.length > MAX_SAVED_PREVIEW_BYTES) return 'oversized';
    // No background queue: skip rather than accumulate GCS FUSE upload handles.
    if (this.activeWrites >= MAX_WRITES || this.writing.has(identity)) return 'busy';
    this.activeWrites++;
    this.writing.add(identity);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const path = this.location(identity, width, format);
      if (!path) return 'unsupported';
      await mkdir(dirname(path), { recursive: true });
      const header = Buffer.alloc(HEADER_BYTES);
      MAGIC.copy(header);
      Buffer.from(identity, 'hex').copy(header, 8);
      header.writeUInt32BE(buffer.length, 40);
      createHash('sha256').update(buffer).digest().copy(header, 44);
      // FUSE does not promise POSIX locking/rename semantics. Concurrent writes,
      // interrupted uploads and stale handles are tolerated: readers accept only
      // a complete, matching envelope. Never unlink a possible other writer's file.
      file = await open(path, 'w');
      await file.writeFile(Buffer.concat([header, buffer]));
      await file.close();
      file = undefined;
      return 'saved';
    } catch {
      return 'error';
    } finally {
      await file?.close().catch(() => {});
      this.writing.delete(identity);
      this.activeWrites--;
    }
  }
}
