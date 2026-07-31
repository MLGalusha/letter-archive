import {
  pageLayoutChecksumSchema,
  pageLayoutV2Schema,
  type PageLayoutV2,
} from '../schemas/page-layout-v2.js';
import { pageLayoutChecksum } from './page-layout-checksum.js';

export interface StoredPageLayoutRecord {
  id: string;
  checksumSha256: string | null;
  pageLayout: unknown;
  pageLayoutChecksumSha256: string | null;
}

export type StoredPageLayoutValidation =
  | { status: 'absent' }
  | {
    status: 'valid';
    layout: PageLayoutV2;
    checksumSha256: string;
  }
  | {
    status: 'invalid';
    reason: string;
  };

/**
 * Validates every invariant that binds immutable layout evidence to a page.
 * Keeping this in one place prevents DTO and route reads from accepting
 * different definitions of a valid stored layout.
 */
export function validateStoredPageLayout(
  record: StoredPageLayoutRecord,
): StoredPageLayoutValidation {
  if (
    record.pageLayout === null
    && record.pageLayoutChecksumSha256 === null
  ) {
    return { status: 'absent' };
  }
  if (
    record.pageLayout === null
    || record.pageLayoutChecksumSha256 === null
  ) {
    return {
      status: 'invalid',
      reason: 'layout document and checksum must both be present',
    };
  }

  const layout = pageLayoutV2Schema.safeParse(record.pageLayout);
  if (!layout.success) {
    return { status: 'invalid', reason: 'layout schema validation failed' };
  }
  const checksum = pageLayoutChecksumSchema.safeParse(
    record.pageLayoutChecksumSha256,
  );
  if (!checksum.success) {
    return { status: 'invalid', reason: 'layout checksum format is invalid' };
  }
  if (layout.data.pageId !== record.id) {
    return { status: 'invalid', reason: 'layout pageId does not match its row' };
  }

  const sourceChecksum = layout.data.image.source?.checksumSha256
    ?? layout.data.image.checksumSha256;
  if (sourceChecksum !== record.checksumSha256) {
    return {
      status: 'invalid',
      reason: 'layout source checksum does not match its page source',
    };
  }
  if (pageLayoutChecksum(layout.data) !== checksum.data) {
    return { status: 'invalid', reason: 'layout integrity checksum mismatch' };
  }

  return {
    status: 'valid',
    layout: layout.data,
    checksumSha256: checksum.data,
  };
}
