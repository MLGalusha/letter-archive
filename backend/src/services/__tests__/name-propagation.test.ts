import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
  loggerChildMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerChildMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
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
    },
  };
});

import { propagateName } from '../name-propagation.js';

describe('name propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue(undefined);
  });

  it('updates every editable metadata prose field and keeps direct quote text untouched', async () => {
    const existingLetter = {
      id: 'letter-1',
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
    };

    findFirstMock
      .mockResolvedValueOnce(existingLetter)
      .mockResolvedValueOnce({
        ...existingLetter,
        sender: 'Jimmy Haller',
        hook: 'Jimmy begs Molly for more time.',
        summary: 'Jimmy Haller begs Molly to wait.',
        metadataV2Json: {
          ...existingLetter.metadataV2Json,
          sender: 'Jimmy Haller',
        },
      });

    await propagateName({
      letterId: 'letter-1',
      field: 'sender',
      oldName: 'Jimmie',
      newName: 'Jimmy Haller',
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
  });
});
