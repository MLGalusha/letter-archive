import { eq, type SQL } from 'drizzle-orm';
import { letters } from '../../db/index.js';

interface TranscriptPublicationState {
  transcriptionStatus: string;
  transcriptStatus: string;
}

interface MetadataPublicationState {
  metadataStatus: string;
  metadataContentStatus: string;
}

/** The single application-level rule for exposing transcript content. */
export function canPublishTranscript(state: TranscriptPublicationState): boolean {
  return state.transcriptionStatus === 'SUCCESS'
    && state.transcriptStatus === 'VERIFIED';
}

/** The single application-level rule for exposing extracted metadata. */
export function canPublishMetadata(state: MetadataPublicationState): boolean {
  return state.metadataStatus === 'SUCCESS'
    && state.metadataContentStatus === 'VERIFIED';
}

/** SQL counterpart used by set-based publication writers. */
export function transcriptPublicationConditions(): SQL[] {
  return [
    eq(letters.transcriptionStatus, 'SUCCESS'),
    eq(letters.transcriptStatus, 'VERIFIED'),
  ];
}

/** SQL counterpart used by set-based publication writers. */
export function metadataPublicationConditions(): SQL[] {
  return [
    eq(letters.metadataStatus, 'SUCCESS'),
    eq(letters.metadataContentStatus, 'VERIFIED'),
  ];
}
