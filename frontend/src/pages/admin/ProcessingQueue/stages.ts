import type {
  ProcessingActiveJob,
  ProcessingJobType,
  ProcessingQueueItem,
  ProcessingQueueStatus,
} from "../../../api/admin/processing";

export interface ProcessingStageDescriptor {
  type: ProcessingJobType;
  label: string;
  description: string;
  queueKey: keyof ProcessingQueueStatus["queued"];
}

export const PROCESSING_STAGES: readonly ProcessingStageDescriptor[] = [
  {
    type: "transcription",
    label: "Transcription",
    description: "OCR and handwriting recognition for uploaded letter pages.",
    queueKey: "transcription",
  },
  {
    type: "extra_content",
    label: "Extra content transcription",
    description: "Transcription of supplementary items related to a letter.",
    queueKey: "extraContent",
  },
  {
    type: "metadata",
    label: "Metadata extraction",
    description: "Sender, recipient, date, summary, and hooks from confirmed transcripts.",
    queueKey: "metadata",
  },
  {
    type: "entity_extraction",
    label: "Entity extraction",
    description: "People and places resolved from successfully extracted metadata.",
    queueKey: "entityExtraction",
  },
] as const;

const STAGES_BY_TYPE = new Map(PROCESSING_STAGES.map((stage) => [stage.type, stage]));

export function getProcessingStage(
  type: ProcessingJobType,
): ProcessingStageDescriptor {
  const stage = STAGES_BY_TYPE.get(type);
  if (!stage) {
    throw new Error(`Unknown processing stage: ${type}`);
  }
  return stage;
}

export function getStageQueue(
  status: ProcessingQueueStatus,
  stage: ProcessingStageDescriptor,
): ProcessingQueueItem[] {
  return status.queued[stage.queueKey];
}

export function getStageActiveJobs(
  status: ProcessingQueueStatus,
  type: ProcessingJobType,
): ProcessingActiveJob[] {
  return status.active.filter((job) => job.type === type);
}
