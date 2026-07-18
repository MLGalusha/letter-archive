import { eq, type SQL } from 'drizzle-orm';
import { letters } from '../../db/index.js';

interface TranscriptPublicationState {
  transcriptStatus: string;
}

interface MetadataPublicationState {
  metadataContentStatus: string;
}

/** A replacement attempt does not invalidate the last committed review. */
export function canPublishTranscript(state: TranscriptPublicationState): boolean {
  return state.transcriptStatus === 'VERIFIED';
}

/** A replacement attempt does not invalidate the last committed review. */
export function canPublishMetadata(state: MetadataPublicationState): boolean {
  return state.metadataContentStatus === 'VERIFIED';
}

/** SQL counterpart used by set-based publication writers. */
export function transcriptPublicationConditions(): SQL[] {
  return [
    eq(letters.transcriptStatus, 'VERIFIED'),
  ];
}

/** SQL counterpart used by set-based publication writers. */
export function metadataPublicationConditions(): SQL[] {
  return [
    eq(letters.metadataContentStatus, 'VERIFIED'),
  ];
}
