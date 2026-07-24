import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findLetterMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  openAiCreateMock,
  safeParseMock,
} = vi.hoisted(() => ({
  findLetterMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  openAiCreateMock: vi.fn(),
  safeParseMock: vi.fn((value: unknown) => ({ success: true, data: value })),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
}));

vi.mock('../../db/index.js', () => {
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  return {
    db: {
      query: { letters: { findFirst: findLetterMock } },
      update: vi.fn(() => ({ set: updateSetMock })),
    },
    letters: {
      id: 'letters.id',
      metadataRevision: 'letters.metadataRevision',
      primarySourceRevision: 'letters.primarySourceRevision',
    },
  };
});

vi.mock('../../config/env.js', () => ({
  env: { OPENAI_MODEL: 'test-model' },
  hasOpenAI: true,
}));

vi.mock('../../ai/openai/client.js', () => ({
  openai: {
    responses: { create: openAiCreateMock },
  },
}));

vi.mock('../../ai/prompts.js', () => ({
  METADATA_UPDATE_SYSTEM_PROMPT: 'system',
  buildMetadataUpdateUserPrompt: vi.fn(() => 'user'),
}));

vi.mock('../../ai/schemas/metadataV2.js', () => ({
  MetadataV2Schema: { safeParse: safeParseMock },
  METADATA_V2_JSON_SCHEMA: {},
}));

vi.mock('../name-propagation.js', () => ({
  deepApplyVariants: vi.fn((value: unknown) => value),
  generateNameVariants: vi.fn(() => []),
  getOtherPeopleFirstNames: vi.fn(() => new Set()),
  parseNameComponents: vi.fn(() => ({})),
  propagateInEntityExtraction: vi.fn((value: unknown) => value),
  propagateInMetadataV2: vi.fn((value: unknown) => value),
}));

vi.mock('../usage-tracking.js', () => ({
  logApiUsage: vi.fn(),
}));

vi.mock('../letter/metadata-job.js', () => ({
  buildHumanMetadataJobPatch: vi.fn(() => ({ metadataStatus: 'SUCCESS' })),
  observedMetadataRevisionConditions: vi.fn((letterId: string, letter: { metadataRevision: number }) => [
    { kind: 'eq', field: 'letters.id', value: letterId },
    { kind: 'eq', field: 'letters.metadataRevision', value: letter.metadataRevision },
  ]),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  })),
}));

import { executeRetagForLetter } from '../metadata-update.js';

const change = {
  primarySourceRevision: 7,
  field: 'sender' as const,
  oldSender: 'Old Sender',
  newSender: 'New Sender',
};

function letter(primarySourceRevision: number) {
  return {
    id: 'letter-1',
    primarySourceRevision,
    metadataRevision: 3,
    sender: 'New Sender',
    recipient: 'Recipient',
    metadataV2Json: {
      sender: 'New Sender',
      recipient: 'Recipient',
      hook: 'Hook',
      summary: 'Summary',
    },
    entityExtractionJson: null,
    aiNotes: [],
  };
}

describe('metadata re-tag page-source ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    openAiCreateMock.mockResolvedValue({
      status: 'completed',
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: JSON.stringify({
            sender: 'New Sender',
            recipient: 'Recipient',
            hook: 'Hook',
            summary: 'Summary',
          }),
        }],
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });

  it('does not call AI for an identity edit from an older page source', async () => {
    findLetterMock.mockResolvedValueOnce(letter(8));

    await expect(
      executeRetagForLetter('letter-1', change),
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'source_changed_before_ai',
    });
    expect(openAiCreateMock).not.toHaveBeenCalled();
  });

  it('does not publish an AI response after the page source changes in flight', async () => {
    findLetterMock
      .mockResolvedValueOnce(letter(7))
      .mockResolvedValueOnce(letter(8));

    await expect(
      executeRetagForLetter('letter-1', change),
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'source_changed_before_save',
    });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('includes the expected page-source revision in the terminal save predicate', async () => {
    findLetterMock
      .mockResolvedValueOnce(letter(7))
      .mockResolvedValueOnce(letter(7));

    await expect(
      executeRetagForLetter('letter-1', change),
    ).resolves.toEqual({ status: 'updated' });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: expect.arrayContaining([
        {
          kind: 'eq',
          field: 'letters.primarySourceRevision',
          value: 7,
        },
      ]),
    });
  });

  it('propagates persistence failures after AI returns instead of reporting a successful no-op', async () => {
    findLetterMock
      .mockResolvedValueOnce(letter(7))
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      executeRetagForLetter('letter-1', change),
    ).rejects.toThrow('database unavailable');
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
