import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  selectForUpdateMock,
  letterFindFirstMock,
  versionFindFirstMock,
  versionFindManyMock,
  insertValuesMock,
  insertReturningMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  deleteWhereMock,
  syncLetterParticipantsFromMetadataMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  selectForUpdateMock: vi.fn(),
  letterFindFirstMock: vi.fn(),
  versionFindFirstMock: vi.fn(),
  versionFindManyMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  const transactionExecutor = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: selectForUpdateMock })),
      })),
    })),
    query: {
      letters: {
        findFirst: letterFindFirstMock,
      },
      letterVersions: {
        findFirst: versionFindFirstMock,
        findMany: versionFindManyMock,
      },
    },
    insert: vi.fn(() => ({ values: insertValuesMock })),
    delete: vi.fn(() => ({ where: deleteWhereMock })),
    update: vi.fn(() => ({ set: updateSetMock })),
  };
  insertValuesMock.mockImplementation(() => ({ returning: insertReturningMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));
  transactionMock.mockImplementation(
    (callback: (tx: typeof transactionExecutor) => unknown) =>
      callback(transactionExecutor),
  );

  return {
    db: {
      transaction: transactionMock,
      query: {
        letterVersions: {
          findMany: versionFindManyMock,
        },
      },
    },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
      metadataRevision: 'letters.metadataRevision',
      updatedAt: 'letters.updatedAt',
      metadataStatus: 'letters.metadataStatus',
      metadataRunId: 'letters.metadataRunId',
      metadataContentStatus: 'letters.metadataContentStatus',
      metadataError: 'letters.metadataError',
      workflow: 'letters.workflow',
      transcriptionText: 'letters.transcriptionText',
      sender: 'letters.sender',
      recipient: 'letters.recipient',
      extractedDate: 'letters.extractedDate',
      locationWritten: 'letters.locationWritten',
      hook: 'letters.hook',
      summary: 'letters.summary',
      emotionalTone: 'letters.emotionalTone',
      senderRecipientRelationship: 'letters.senderRecipientRelationship',
      primaryTopics: 'letters.primaryTopics',
      tags: 'letters.tags',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionError: 'letters.entityExtractionError',
    },
    letterVersions: {
      letterId: 'letterVersions.letterId',
      fieldType: 'letterVersions.fieldType',
      versionNumber: 'letterVersions.versionNumber',
      primarySourceRevision: 'letterVersions.primarySourceRevision',
      createdAt: 'letterVersions.createdAt',
    },
  };
});

vi.mock('../letters.js', () => ({
  getLetterById: vi.fn(),
}));

vi.mock('../entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  createVersion,
  getVersions,
  restoreVersion,
  type VersionInput,
} from '../letter/versions.js';
import type { MetadataVersionContent } from '../letter/version-content.js';

const currentLetter = {
  id: 'letter-1',
  primarySourceRevision: 7,
  transcriptionText: 'Saved transcript',
  sender: 'Current sender',
  recipient: 'Current recipient',
  extractedDate: '1947-08-10',
  locationWritten: 'Current location',
  hook: 'Current hook',
  summary: 'Current summary',
  emotionalTone: 'nostalgic',
  senderRecipientRelationship: 'friend',
  primaryTopics: ['family/separation-reunion', 'travel/journey'],
  tags: ['family/separation-reunion', 'travel/journey'],
  transcriptionStatus: 'RUNNING',
  transcriptionRunId: 'old-run',
  transcriptStatus: 'VERIFIED',
  transcriptConfirmedAt: new Date('2026-07-16T12:00:00.000Z'),
  transcriptConfirmedBy: 'reviewer-1',
  workflow: 'TRANSCRIBING',
  metadataRevision: 3,
  metadataV2Json: null,
  metadataJson: null,
  updatedAt: new Date('2026-07-17T12:00:00.000Z'),
};

const currentMetadataSnapshot: MetadataVersionContent = {
  sender: currentLetter.sender,
  recipient: currentLetter.recipient,
  extractedDate: currentLetter.extractedDate,
  locationWritten: currentLetter.locationWritten,
  hook: currentLetter.hook,
  summary: currentLetter.summary,
  emotionalTone: 'nostalgic',
  senderRecipientRelationship: 'friend',
  primaryTopics: [...currentLetter.primaryTopics],
};

function metadataVersionInput(content: unknown): VersionInput {
  return {
    primarySourceRevision: 7,
    fieldType: 'metadata',
    content,
    source: 'human',
  } as VersionInput;
}

describe('source-bound letter versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectForUpdateMock.mockResolvedValue([currentLetter]);
    letterFindFirstMock.mockResolvedValue({
      primarySourceRevision: currentLetter.primarySourceRevision,
    });
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
    deleteWhereMock.mockResolvedValue(undefined);
    syncLetterParticipantsFromMetadataMock.mockResolvedValue(undefined);
  });

  it('reads the source epoch and its visible versions from one repeatable-read snapshot', async () => {
    versionFindManyMock.mockResolvedValue([{
      versionNumber: 3,
      content: { text: 'Current transcript' },
      source: 'human',
      createdAt: new Date('2026-07-18T12:00:00.000Z'),
    }]);

    await expect(getVersions('letter-1', 'transcript')).resolves.toEqual([{
      versionNumber: 3,
      content: { text: 'Current transcript' },
      source: 'human',
      createdAt: '2026-07-18T12:00:00.000Z',
    }]);
    expect(transactionMock).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      },
    );
    expect(versionFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        kind: 'and',
        clauses: expect.arrayContaining([
          {
            kind: 'eq',
            field: 'letterVersions.primarySourceRevision',
            value: 7,
          },
        ]),
      },
    }));
  });

  it('creates a version only while the locked letter still owns the expected source', async () => {
    versionFindManyMock.mockResolvedValue([{ versionNumber: 2 }]);
    insertReturningMock.mockResolvedValue([{
      versionNumber: 3,
      createdAt: new Date('2026-07-18T12:00:00.000Z'),
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'transcript',
      content: 'Saved transcript',
      source: 'human',
    })).resolves.toEqual({
      kind: 'created',
      version: {
        versionNumber: 3,
        createdAt: '2026-07-18T12:00:00.000Z',
      },
    });
    expect(insertReturningMock).toHaveBeenCalledOnce();
  });

  it('does not create a version after the page source changed', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      primarySourceRevision: 8,
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'transcript',
      content: 'Stale transcript',
      source: 'human',
    })).resolves.toEqual({ kind: 'source_changed' });
    expect(versionFindManyMock).not.toHaveBeenCalled();
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it('does not record a delayed same-source snapshot after authoritative content changed', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      transcriptionText: 'A newer save won',
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'transcript',
      content: 'Delayed older save',
      source: 'human',
    })).resolves.toEqual({ kind: 'content_changed' });
    expect(versionFindManyMock).not.toHaveBeenCalled();
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it.each([
    ['sender', 'Stale sender'],
    ['recipient', 'Stale recipient'],
    ['extractedDate', '1947-08-11'],
    ['locationWritten', 'Stale location'],
    ['hook', 'Stale hook'],
    ['summary', 'Stale summary'],
    ['emotionalTone', 'anxious'],
    ['senderRecipientRelationship', 'sibling'],
    ['primaryTopics', ['community/local-events']],
  ])('rejects a metadata snapshot when %s differs from the locked letter', async (
    field,
    staleValue,
  ) => {
    versionFindManyMock.mockResolvedValue([{ versionNumber: 3 }]);
    insertReturningMock.mockResolvedValue([{
      versionNumber: 4,
      createdAt: new Date('2026-07-18T12:00:00.000Z'),
    }]);

    await expect(createVersion('letter-1', metadataVersionInput({
      ...currentMetadataSnapshot,
      [field]: staleValue,
    }))).resolves.toEqual({ kind: 'content_changed' });
    expect(versionFindManyMock).not.toHaveBeenCalled();
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it('accepts a recognized partial metadata candidate and inserts the locked canonical snapshot', async () => {
    versionFindManyMock.mockResolvedValue([{ versionNumber: 3 }]);
    insertReturningMock.mockResolvedValue([{
      versionNumber: 4,
      createdAt: new Date('2026-07-18T12:00:00.000Z'),
    }]);

    await expect(createVersion('letter-1', {
      primarySourceRevision: 7,
      fieldType: 'metadata',
      content: { hook: 'Current hook' },
      source: 'human',
    })).resolves.toEqual({
      kind: 'created',
      version: {
        versionNumber: 4,
        createdAt: '2026-07-18T12:00:00.000Z',
      },
    });
    expect(insertValuesMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      fieldType: 'metadata',
      versionNumber: 4,
      content: currentMetadataSnapshot,
      source: 'human',
      primarySourceRevision: 7,
    });
  });

  it.each([
    ['an empty candidate', {}],
    ['a candidate with no recognized fields', { futureMetadataField: 'value' }],
  ])('rejects %s before looking up or writing versions', async (_caseName, content) => {
    await expect(
      createVersion('letter-1', metadataVersionInput(content)),
    ).resolves.toEqual({ kind: 'invalid_content' });
    expect(versionFindManyMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('restores transcript content and revokes confirmation under the same source lock', async () => {
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: { text: 'Restored by an admin' },
    });

    await expect(
      restoreVersion('letter-1', 3, 'transcript', 7),
    ).resolves.toEqual({ kind: 'restored' });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      transcriptionText: 'Restored by an admin',
      transcriptionStatus: 'SUCCESS',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      workflow: 'TRANSCRIBED',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataPublished: false,
      transcriptPublished: false,
      updatedAt: expect.any(Date),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.metadataRevision', value: 3 },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
      ]),
    }));
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['an empty object', {}],
    ['a metadata object', { sender: 'Wrong kind' }],
    ['a null text value', { text: null }],
    ['a non-string text value', { text: 42 }],
  ])('rejects invalid stored transcript content (%s) without writing', async (
    _caseName,
    content,
  ) => {
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content,
    });

    await expect(
      restoreVersion('letter-1', 3, 'transcript', 7),
    ).resolves.toEqual({ kind: 'invalid_content' });
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('rejects both a stale request epoch and a version from an older source epoch', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      primarySourceRevision: 8,
    }]);
    await expect(
      restoreVersion('letter-1', 3, 'transcript', 7),
    ).resolves.toEqual({ kind: 'source_changed' });
    expect(versionFindFirstMock).not.toHaveBeenCalled();

    selectForUpdateMock.mockResolvedValueOnce([currentLetter]);
    versionFindFirstMock.mockResolvedValueOnce({
      primarySourceRevision: 6,
      content: { text: 'Old scan transcript' },
    });
    await expect(
      restoreVersion('letter-1', 3, 'transcript', 7),
    ).resolves.toEqual({ kind: 'source_changed' });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('fully restores all canonical metadata fields, mirrored tags, documents, and participants', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      metadataV2Json: {
        sender: 'Current sender',
        recipient: 'Current recipient',
        extracted_date: '1947-08-10',
        location_written: 'Current location',
        hook: 'Current hook',
        summary: 'Current summary',
        emotional_tone: 'nostalgic',
        sender_recipient_relationship: 'friend',
        primary_topics: ['family/separation-reunion', 'travel/journey'],
        preservedField: 'preserved',
      },
      metadataJson: { obsoleteShape: true },
    }]);
    const restoredMetadata = {
      sender: 'Restored sender',
      recipient: 'Restored recipient',
      extractedDate: '1948-01-02',
      locationWritten: 'Cambridge',
      hook: 'Restored hook',
      summary: 'Restored summary',
      emotionalTone: 'grateful',
      senderRecipientRelationship: 'sibling',
      primaryTopics: ['family/children', 'community/local-events'],
    };
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: restoredMetadata,
    });

    await expect(
      restoreVersion('letter-1', 2, 'metadata', 7),
    ).resolves.toEqual({ kind: 'restored' });

    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      sender: 'Restored sender',
      recipient: 'Restored recipient',
      relationshipType: 'sibling',
      database: expect.objectContaining({
        update: expect.any(Function),
      }),
    });
    const updates = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updates).toEqual(expect.objectContaining({
      ...restoredMetadata,
      tags: restoredMetadata.primaryTopics,
    }));
    const expectedDocument = expect.objectContaining({
      sender: 'Restored sender',
      recipient: 'Restored recipient',
      extracted_date: '1948-01-02',
      location_written: 'Cambridge',
      hook: 'Restored hook',
      summary: 'Restored summary',
      emotional_tone: 'grateful',
      sender_recipient_relationship: 'sibling',
      primary_topics: ['family/children', 'community/local-events'],
      preservedField: 'preserved',
    });
    expect(updates.metadataV2Json).toEqual(expectedDocument);
    expect(updates.metadataJson).toEqual(expectedDocument);
  });

  it('restores a partial legacy metadata row by presence without clearing omitted fields', async () => {
    selectForUpdateMock.mockResolvedValueOnce([{
      ...currentLetter,
      metadataJson: {
        sender: 'Current sender',
        recipient: 'Current recipient',
        locationWritten: 'Current location',
        hook: 'Current hook',
        summary: 'Current summary',
        preservedField: 'preserved',
      },
    }]);
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: {
        sender: 'Legacy restored sender',
        hook: 'Legacy restored hook',
      },
    });

    await expect(
      restoreVersion('letter-1', 2, 'metadata', 7),
    ).resolves.toEqual({ kind: 'restored' });

    const updates = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updates.sender).toBe('Legacy restored sender');
    expect(updates.hook).toBe('Legacy restored hook');
    for (const omittedField of [
      'recipient',
      'extractedDate',
      'locationWritten',
      'summary',
      'emotionalTone',
      'senderRecipientRelationship',
      'primaryTopics',
      'tags',
    ]) {
      expect(updates).not.toHaveProperty(omittedField);
    }
    expect(updates.metadataJson).toEqual(expect.objectContaining({
      sender: 'Legacy restored sender',
      recipient: 'Current recipient',
      locationWritten: 'Current location',
      hook: 'Legacy restored hook',
      summary: 'Current summary',
      preservedField: 'preserved',
    }));
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      sender: 'Legacy restored sender',
      recipient: undefined,
      relationshipType: undefined,
      database: expect.any(Object),
    });
  });

  it('honors explicit null, empty string, and empty array values in a partial metadata row', async () => {
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: {
        sender: null,
        hook: '',
        primaryTopics: [],
      },
    });

    await expect(
      restoreVersion('letter-1', 2, 'metadata', 7),
    ).resolves.toEqual({ kind: 'restored' });

    const updates = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updates).toEqual(expect.objectContaining({
      sender: null,
      hook: '',
      primaryTopics: [],
      tags: [],
    }));
    expect(updates).not.toHaveProperty('recipient');
    expect(updates).not.toHaveProperty('summary');
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      sender: null,
      recipient: undefined,
      relationshipType: undefined,
      database: expect.any(Object),
    });
  });

  it.each([
    ['null', null],
    ['a raw string', 'metadata'],
    ['an array', []],
    ['an empty object', {}],
    ['an object with no recognized fields', { futureMetadataField: 'value' }],
    ['a non-string scalar', { sender: 42 }],
    ['an invalid date', { extractedDate: 'August 10, 1947' }],
    ['an invalid emotional tone', { emotionalTone: 'not-a-tone' }],
    ['an invalid relationship', { senderRecipientRelationship: 'not-a-relationship' }],
    ['a non-array topic value', { primaryTopics: 'family/children' }],
  ])('rejects invalid stored metadata content (%s) without writes or participant sync', async (
    _caseName,
    content,
  ) => {
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content,
    });

    await expect(
      restoreVersion('letter-1', 2, 'metadata', 7),
    ).resolves.toEqual({ kind: 'invalid_content' });
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('does not report a metadata restore when participant projection aborts its transaction', async () => {
    versionFindFirstMock.mockResolvedValue({
      primarySourceRevision: 7,
      content: {
        sender: 'Restored sender',
        recipient: 'Restored recipient',
      },
    });
    syncLetterParticipantsFromMetadataMock.mockRejectedValueOnce(
      new Error('participant projection failed'),
    );

    await expect(
      restoreVersion('letter-1', 2, 'metadata', 7),
    ).rejects.toThrow('participant projection failed');
    expect(transactionMock).toHaveBeenCalledOnce();
  });
});
