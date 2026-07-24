import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
  loggerChildMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerChildMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../utils/logger.js', () => {
  const logger = {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    child: loggerChildMock,
  };

  loggerChildMock.mockReturnValue(logger);

  return {
    createLogger: vi.fn(() => logger),
  };
});

vi.mock('../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));

  return {
    db: {
      query: {
        letters: {
          findFirst: findFirstMock,
        },
      },
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      primarySourceRevision: 'letters.primarySourceRevision',
      sender: 'letters.sender',
      recipient: 'letters.recipient',
      metadataStatus: 'letters.metadataStatus',
      metadataRunId: 'letters.metadataRunId',
      metadataRevision: 'letters.metadataRevision',
      metadataContentStatus: 'letters.metadataContentStatus',
      metadataError: 'letters.metadataError',
      workflow: 'letters.workflow',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      entityExtractionError: 'letters.entityExtractionError',
      updatedAt: 'letters.updatedAt',
    },
  };
});

import { commitDirectIdentityField, propagateName } from '../name-propagation.js';

describe('name propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([{ id: 'letter-1' }]);
  });

  it('updates every editable metadata prose field and keeps direct quote text untouched', async () => {
    const existingLetter = {
      id: 'letter-1',
      primarySourceRevision: 7,
      sender: 'Jimmie',
      recipient: 'Molly',
      hook: 'The sender begs Molly for more time.',
      summary: 'The sender begs Molly to wait.',
      metadataV2Json: {
        sender: 'Jimmie',
        recipient: 'Molly',
        hook: 'The sender begs Molly for more time.',
        summary: 'The sender begs Molly to wait.',
        location_written: null,
        extracted_date: '1947-09-19',
        emotional_tone: 'anxious',
        sender_recipient_relationship: 'romantic-partner',
        primary_topics: ['family/courtship-romance'],
        notable_quotes: [
          {
            text: 'Molly, please wait for me.',
            context: 'The sender pleads with Molly.',
            position: 'middle',
          },
        ],
        ai_notes: [
          {
            content: 'The sender says Molly should reply.',
            category: 'identity',
            priority: 'medium',
            resolves_when: null,
          },
        ],
      },
      entityExtractionJson: null,
      aiNotes: null,
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataRevision: 2,
      metadataContentStatus: 'EDITED',
      metadataError: null,
      workflow: 'METADATA_DRAFTED',
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };

    const committedLetter = {
      ...existingLetter,
      sender: 'Jimmy Haller',
      hook: 'Jimmy begs Molly for more time.',
      summary: 'Jimmy Haller begs Molly to wait.',
      metadataRevision: 3,
      updatedAt: new Date('2026-07-17T12:01:00.000Z'),
      metadataV2Json: {
        ...existingLetter.metadataV2Json,
        sender: 'Jimmy Haller',
      },
    };

    findFirstMock.mockResolvedValueOnce(existingLetter);
    updateReturningMock.mockResolvedValueOnce([committedLetter]);

    const result = await propagateName({
      letterId: 'letter-1',
      field: 'sender',
      oldName: 'Jimmie',
      newName: 'Jimmy Haller',
      observed: {
        value: 'Jimmie',
        primarySourceRevision: 7,
        metadataRevision: 2,
        updatedAt: existingLetter.updatedAt,
      },
    });

    expect(updateSetMock).toHaveBeenCalledTimes(1);

    const updates = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    const metadata = updates.metadataV2Json as {
      sender: string;
      hook: string;
      summary: string;
      notable_quotes: Array<{ text: string; context: string; position: string }>;
      ai_notes: Array<{ content: string }>;
    };

    expect(updates).toEqual(expect.objectContaining({
      sender: 'Jimmy Haller',
      hook: 'Jimmy begs Molly for more time.',
      summary: 'Jimmy Haller begs Molly to wait.',
      updatedAt: expect.any(Date),
    }));

    expect(metadata.sender).toBe('Jimmy Haller');
    expect(metadata.hook).toBe('Jimmy begs Molly for more time.');
    expect(metadata.summary).toBe('Jimmy Haller begs Molly to wait.');
    expect(metadata.ai_notes[0]?.content).toBe('Jimmy Haller says Molly should reply.');
    expect(metadata.notable_quotes[0]?.context).toBe('Jimmy Haller pleads with Molly.');
    expect(metadata.notable_quotes[0]?.text).toBe('Molly, please wait for me.');
    expect(result.letter).toBe(committedLetter);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        kind: 'and',
        clauses: [
          { kind: 'eq', field: 'letters.id', value: 'letter-1' },
          { kind: 'eq', field: 'letters.metadataRevision', value: 2 },
          { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
          { kind: 'eq', field: 'letters.sender', value: 'Jimmie' },
        ],
      },
    });
    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'and',
      clauses: expect.arrayContaining([
        { kind: 'eq', field: 'letters.sender', value: 'Jimmie' },
      ]),
    }));
  });

  it('rejects a stale caller observation before building or writing propagation changes', async () => {
    const observedAt = new Date('2026-07-17T12:00:00.000Z');
    findFirstMock.mockResolvedValueOnce(undefined);

    await expect(propagateName({
      letterId: 'letter-1',
      field: 'recipient',
      oldName: 'Molly',
      newName: 'Mary',
      observed: {
        value: 'Molly',
        primarySourceRevision: 7,
        metadataRevision: 2,
        updatedAt: observedAt,
      },
    })).rejects.toMatchObject({ status: 409 });

    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('propagates through a legacy-only metadata document without inventing V2', async () => {
    const existingLetter = {
      id: 'letter-legacy',
      primarySourceRevision: 7,
      sender: 'Jimmie',
      recipient: 'Molly',
      hook: 'The sender writes to Molly.',
      summary: 'Jimmie asks Molly to wait.',
      metadataV2Json: null,
      metadataJson: {
        sender: 'Jimmie',
        recipient: 'Molly',
        hook: 'The sender writes to Molly.',
        summary: 'Jimmie asks Molly to wait.',
        locationWritten: 'Boston',
      },
      entityExtractionJson: null,
      aiNotes: null,
      metadataStatus: 'SUCCESS',
      metadataRunId: null,
      metadataRevision: 2,
      metadataContentStatus: 'EDITED',
      metadataError: null,
      workflow: 'METADATA_DRAFTED',
      entityExtractionStatus: 'PENDING',
      entityExtractionError: null,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    findFirstMock.mockResolvedValueOnce(existingLetter);
    updateReturningMock.mockResolvedValueOnce([{
      ...existingLetter,
      sender: 'Jimmy Haller',
      metadataRevision: 3,
    }]);

    await propagateName({
      letterId: existingLetter.id,
      field: 'sender',
      oldName: 'Jimmie',
      newName: 'Jimmy Haller',
      observed: {
        value: 'Jimmie',
        primarySourceRevision: 7,
        metadataRevision: 2,
        updatedAt: existingLetter.updatedAt,
      },
    });

    const updates = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(updates).not.toHaveProperty('metadataV2Json');
    expect(updates.metadataJson).toEqual(expect.objectContaining({
      sender: 'Jimmy Haller',
      hook: 'Jimmy writes to Molly.',
      summary: 'Jimmy Haller asks Molly to wait.',
      locationWritten: 'Boston',
    }));
  });

  it('does not mutate lifecycle state for an exact same-value request', async () => {
    const letter = {
      id: 'letter-1',
      primarySourceRevision: 7,
      sender: 'Jimmie',
      recipient: 'Molly',
      metadataRevision: 2,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    findFirstMock.mockResolvedValueOnce(letter);

    await expect(propagateName({
      letterId: letter.id,
      field: 'sender',
      oldName: letter.sender,
      newName: letter.sender,
      observed: {
        value: letter.sender,
        primarySourceRevision: 7,
        metadataRevision: letter.metadataRevision,
        updatedAt: letter.updatedAt,
      },
    })).resolves.toEqual({ letter, fieldsUpdated: [] });

    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('guards the direct fallback with the observed revision and target value', async () => {
    const letter = {
      id: 'letter-1',
      primarySourceRevision: 7,
      sender: 'Jimmie',
      recipient: 'Molly',
      metadataRevision: 4,
      metadataV2Json: null,
      metadataJson: { sender: 'Jimmie', recipient: 'Molly' },
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    const committed = {
      ...letter,
      sender: 'Jimmy',
      metadataRevision: 5,
      updatedAt: new Date('2026-07-17T12:01:00.000Z'),
    };
    updateReturningMock.mockResolvedValueOnce([committed]);

    await expect(commitDirectIdentityField({
      letter,
      field: 'sender',
      value: 'Jimmy',
    })).resolves.toBe(committed);

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      sender: 'Jimmy',
      metadataJson: { sender: 'Jimmy', recipient: 'Molly' },
      updatedAt: expect.any(Date),
    }));
    expect(updateSetMock.mock.calls[0]![0]).not.toHaveProperty('metadataV2Json');
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: letter.id },
        { kind: 'eq', field: 'letters.metadataRevision', value: 4 },
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
        { kind: 'eq', field: 'letters.sender', value: 'Jimmie' },
      ],
    });
  });

  it('returns a 409 when the direct fallback CAS loses', async () => {
    const letter = {
      id: 'letter-1',
      primarySourceRevision: 7,
      sender: null,
      recipient: 'Molly',
      metadataRevision: 4,
      updatedAt: new Date('2026-07-17T12:00:00.000Z'),
    };
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(commitDirectIdentityField({
      letter,
      field: 'sender',
      value: 'Jimmy',
    })).rejects.toMatchObject({ status: 409 });

    expect(updateWhereMock).toHaveBeenCalledWith(expect.objectContaining({
      clauses: expect.arrayContaining([
        { kind: 'isNull', field: 'letters.sender' },
      ]),
    }));
  });
});
