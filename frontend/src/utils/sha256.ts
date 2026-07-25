import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Returns the lowercase SHA-256 hex digest of the exact UTF-8 bytes in `value`.
 *
 * The audited JavaScript implementation is deliberate: Web Crypto is absent in
 * insecure browser contexts, including the supported HTTP phone/LAN workflow.
 * TextEncoder preserves the same exact UTF-8 boundary without normalizing text.
 */
export async function sha256Utf8(value: string): Promise<string> {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}
