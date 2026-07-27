import { sql } from '../db/index.js';

/**
 * Holds one PostgreSQL session for the complete non-force checksum workflow.
 * Transaction-scoped locks inside individual read/write helpers cannot cover
 * the gap between duplicate preflight and first collection/page creation.
 */
export async function withContentChecksumLock<T>(
  checksumSha256: string,
  work: () => Promise<T>,
): Promise<T> {
  const reserved = await sql.reserve();
  let locked = false;
  try {
    await reserved`
      SELECT pg_advisory_lock(
        hashtextextended(${checksumSha256}, 0)
      )
    `;
    locked = true;
    return await work();
  } finally {
    try {
      if (locked) {
        await reserved`
          SELECT pg_advisory_unlock(
            hashtextextended(${checksumSha256}, 0)
          )
        `;
      }
    } finally {
      reserved.release();
    }
  }
}
