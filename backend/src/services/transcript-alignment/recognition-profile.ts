import { canonicalJsonChecksum } from '../page-layout-checksum.js';

const MCCATMUS_MODEL_SHA256 =
  'dfb911ba25fd11f93efc1b0c340957162981ecfdaac0ee1e26793d491f770244';

export const CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE = Object.freeze({
  accelerator: 'cpu',
  precision: '32-true',
  batchSize: 1,
  numLineWorkers: 0,
  numThreads: 1,
  padding: 16,
  segmentationType: 'baselines',
});

export const CURRENT_TRANSCRIPT_RECOGNITION_PROFILE = Object.freeze({
  engine: 'kraken',
  engineVersion: '7.0.3',
  modelName: 'McCATMuS_nfd_nofix_V1.mlmodel',
  modelChecksumSha256: MCCATMUS_MODEL_SHA256,
  configChecksumSha256: canonicalJsonChecksum(
    CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
  ),
  profileChecksumSha256: canonicalJsonChecksum({
    engine: 'kraken',
    engineVersion: '7.0.3',
    modelName: 'McCATMuS_nfd_nofix_V1.mlmodel',
    modelChecksumSha256: MCCATMUS_MODEL_SHA256,
    inference: CURRENT_TRANSCRIPT_RECOGNITION_INFERENCE,
  }),
});

export const TRANSCRIPT_ALIGNMENT_ALGORITHM = Object.freeze({
  name: 'content-aware-transcript-alignment' as const,
  version: 'production-v1',
  configChecksumSha256: canonicalJsonChecksum({
    maxGroupSize: 2,
    topK: 5,
    humanGapFillPolicy: 'geometry-only-between-anchors-v1',
    secondaryFlowPolicy: 'defer-v1',
  }),
});
