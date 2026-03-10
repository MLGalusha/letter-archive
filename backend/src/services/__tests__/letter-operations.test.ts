import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  dbDeleteMock,
  deleteWhereMock,
  runTranscriptionMock,
  getLetterByIdMock,
  auditMetadataMock,
  resyncMetadataMock,
  syncLetterParticipantsFromMetadataMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  dbDeleteMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  runTranscriptionMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  auditMetadataMock: vi.fn(),
  resyncMetadataMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));
  dbDeleteMock.mockImplementation(() => ({
    where: deleteWhereMock,
  }));

  return {
    db: {
      query: {
        letters: {
          findFirst: findFirstMock,
          findMany: findManyMock,
        },
      },
      update: dbUpdateMock,
      delete: dbDeleteMock,
    },
    letters: {
      id: 'letters.id',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      typeSequence: 'letters.typeSequence',
      type: 'letters.type',
    },
    letterVersions: {
      letterId: 'letterVersions.letterId',
    },
    letterPersons: {
      letterId: 'letterPersons.letterId',
    },
    letterPlaces: {
      letterId: 'letterPlaces.letterId',
    },
    canonicalPersons: {
      id: 'canonicalPersons.id',
    },
    canonicalPlaces: {
      id: 'canonicalPlaces.id',
    },
    personRelationships: {
      discoveredInLetterId: 'personRelationships.discoveredInLetterId',
    },
  };
});

vi.mock('../letters.js', () => ({
  getLetterById: getLetterByIdMock,
}));

vi.mock('../../pipeline/processor.js', () => ({
  runTranscription: runTranscriptionMock,
}));

vi.mock('../../pipeline/metadataV2.js', () => ({
  runMetadataExtractionV2: vi.fn(),
  runEntityExtractionOnly: vi.fn(),
}));

vi.mock('../../ai/resync.js', () => ({
  resyncMetadata: resyncMetadataMock,
  auditMetadata: auditMetadataMock,
}));

vi.mock('../../ai/openai.js', () => ({
  checkExtraContentForText: vi.fn(),
  transcribeExtraContent: vi.fn(),
  transcribeImage: vi.fn(),
}));

vi.mock('../storage.js', () => ({
  getAbsoluteStoragePath: vi.fn((value: string) => value),
}));

vi.mock('../line-finder.js', () => ({
  detectAndStoreLinesForPages: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../processing-queue.js', () => ({
  getProcessingStatus: vi.fn(),
  resetProcessingState: vi.fn(),
  processLettersAsync: vi.fn(),
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
}));

import {
  bulkClearMetadata,
  normalizeRelationshipType,
  regenerateTranscription,
  resyncCheck,
  resyncLetterMetadata,
  transcribeLetterOnly,
  updateExtraContent,
} from '../letter-operations.js';

describe('letter operations service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
    deleteWhereMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    getLetterByIdMock.mockResolvedValue(undefined);
  });

  it('normalizes common AI relationship variants', () => {
    expect(normalizeRelationshipType('fiance')).toBe('fiancé/fiancée');
    expect(normalizeRelationshipType('coworker')).toBe('business-associate');
    expect(normalizeRelationshipType('something unexpected')).toBe('unknown');
  });

  it('clears stored metadata JSON when metadata is bulk-cleared', async () => {
    const result = await bulkClearMetadata(['letter-1', 'letter-2']);

    expect(result).toEqual({
      message: 'Metadata cleared',
      updated: 2,
    });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: null,
        recipient: null,
        metadataStatus: 'PENDING',
        metadataError: null,
        metadataJson: null,
        metadataV2Json: null,
        entityExtractionJson: null,
        entityExtractionStatus: 'PENDING',
        entityExtractionError: null,
        workflow: 'TRANSCRIBED',
        updatedAt: expect.any(Date),
      }),
    );
  });

  it('does not reset transcription state when letter-only transcription is rejected for missing pages', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-3',
      type: 'L',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      pages: [],
    });

    await expect(transcribeLetterOnly('letter-3')).rejects.toMatchObject({
      message: 'Letter has no pages to transcribe',
      status: 400,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runTranscriptionMock).not.toHaveBeenCalled();
  });

  it('does not reset transcription state when regeneration is rejected for missing pages', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-4',
      type: 'L',
      collection: { collectionCode: '009' },
      dateRaw: '19470810',
      pages: [],
    });

    await expect(regenerateTranscription('letter-4', false)).rejects.toMatchObject({
      message: 'Letter has no pages to transcribe',
      status: 400,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runTranscriptionMock).not.toHaveBeenCalled();
  });

  it('marks manual extra-content edits as edited when content is added from an empty state', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-5',
      extraContentStatus: 'EMPTY',
    });

    const result = await updateExtraContent('letter-5', 'Typed by an admin');

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: 'Typed by an admin',
      extraContentStatus: 'EDITED',
      updatedAt: expect.any(Date),
    });
  });

  it('resets extra-content to empty and clears verification metadata when content is removed', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-6',
      extraContentStatus: 'VERIFIED',
    });

    const result = await updateExtraContent('letter-6', '   ');

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: null,
      extraContentStatus: 'EMPTY',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('drops verified extra-content back to edited when content is changed directly', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-7',
      extraContentStatus: 'VERIFIED',
    });

    const result = await updateExtraContent('letter-7', 'Corrected note text');

    expect(result).toBe(true);
    expect(updateSetMock).toHaveBeenCalledWith({
      extraContentTranscript: 'Corrected note text',
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: null,
      extraContentVerifiedBy: null,
      updatedAt: expect.any(Date),
    });
  });

  it('passes explicit null sender and recipient changes through metadata audit checks', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-8',
      sender: 'Alice',
      recipient: 'Bob',
      extractedDate: '1947-08-10',
      summary: 'Alice writes to Bob.',
      hook: 'Alice reaches out to Bob.',
      senderRecipientRelationship: 'friend',
      metadataV2Json: {
        notable_quotes: [
          { text: 'Hello there', context: 'Alice greets Bob.', position: 'opening' },
        ],
      },
      persons: [
        { role: 'sender', person: { canonicalName: 'Alice' } },
        { role: 'recipient', person: { canonicalName: 'Bob' } },
      ],
    });
    auditMetadataMock.mockResolvedValue({
      shouldUpdateSummary: false,
      shouldUpdateHook: false,
      shouldCreateSenderPerson: false,
      shouldCreateRecipientPerson: false,
      shouldUpdateRelationship: false,
      shouldUpdateQuoteContexts: false,
      issues: [],
      reason: 'No changes needed',
    });

    const result = await resyncCheck('letter-8', {
      oldSender: 'Alice',
      newSender: null,
      oldRecipient: 'Bob',
      newRecipient: null,
    });

    expect(auditMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: null,
        recipient: null,
        linkedPersons: [
          { canonicalName: 'Alice', role: 'sender' },
          { canonicalName: 'Bob', role: 'recipient' },
        ],
        quoteContexts: [
          { text: 'Hello there', context: 'Alice greets Bob.', position: 'opening' },
        ],
      }),
      {
        oldSender: 'Alice',
        newSender: null,
        oldRecipient: 'Bob',
        newRecipient: null,
      },
    );
    expect(result).toEqual({
      needsResync: false,
      decision: expect.objectContaining({ reason: 'No changes needed' }),
    });
  });

  it('syncs participants with cleared recipients during metadata resync', async () => {
    findFirstMock.mockResolvedValue({
      id: 'letter-9',
      sender: 'Alice',
      recipient: 'Bob',
      transcriptionText: 'Original transcript',
      extractedDate: '1947-08-10',
      summary: 'Alice writes to Bob.',
      hook: 'Alice reaches out to Bob.',
      senderRecipientRelationship: 'friend',
      metadataV2Json: { topics: ['war'] },
      persons: [],
    });
    resyncMetadataMock.mockResolvedValue({
      summary: 'Alice writes after the recipient was removed.',
      hook: null,
      senderPerson: null,
      recipientPerson: null,
      relationshipType: null,
      updatedQuoteContexts: null,
      wasUpdated: true,
      decision: {
        shouldUpdateSummary: true,
        shouldUpdateHook: false,
        shouldCreateSenderPerson: false,
        shouldCreateRecipientPerson: false,
        shouldUpdateRelationship: false,
        shouldUpdateQuoteContexts: false,
        issues: ['Recipient was removed'],
        reason: 'Recipient cleared',
      },
    });

    const result = await resyncLetterMetadata('letter-9', {
      oldSender: 'Alice',
      newSender: 'Alice',
      oldRecipient: 'Bob',
      newRecipient: null,
    });

    expect(resyncMetadataMock).toHaveBeenCalledWith({
      transcript: 'Original transcript',
      context: expect.objectContaining({
        sender: 'Alice',
        recipient: null,
      }),
      change: {
        oldSender: 'Alice',
        newSender: 'Alice',
        oldRecipient: 'Bob',
        newRecipient: null,
      },
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      summary: 'Alice writes after the recipient was removed.',
      updatedAt: expect.any(Date),
    });
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-9',
      sender: 'Alice',
      recipient: null,
      relationshipType: 'friend',
    });
    expect(result).toEqual({
      wasUpdated: true,
      updatedFields: {
        summary: true,
        hook: false,
        senderPerson: false,
        recipientPerson: false,
        relationshipType: false,
        quoteContexts: false,
      },
      decision: expect.objectContaining({ reason: 'Recipient cleared' }),
    });
  });
});
