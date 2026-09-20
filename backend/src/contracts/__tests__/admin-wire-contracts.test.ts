import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  PROCESSING_JOB_TYPES,
  type ProcessingJobActionRequest,
  type ProcessingJobSnapshot,
  type ProcessingQueueClearRequest,
} from '../admin-wire-contracts.js';
import {
  clearProcessingQueueSnapshotSchema,
  processingJobActionSchema,
  processingJobSnapshotSchema,
  queueJobTypeSchema,
} from '../../services/processing-queue-snapshot.js';

describe('admin wire contracts', () => {
  it('uses the canonical processing job tuple in request validation', () => {
    expect(queueJobTypeSchema.options).toEqual(PROCESSING_JOB_TYPES);
  });

  it('keeps processing request schemas equal to their wire types', () => {
    expectTypeOf<z.infer<typeof processingJobSnapshotSchema>>()
      .toEqualTypeOf<ProcessingJobSnapshot>();
    expectTypeOf<z.infer<typeof processingJobActionSchema>>()
      .toEqualTypeOf<ProcessingJobActionRequest>();
    expectTypeOf<z.infer<typeof clearProcessingQueueSnapshotSchema>>()
      .toEqualTypeOf<ProcessingQueueClearRequest>();
  });
});
