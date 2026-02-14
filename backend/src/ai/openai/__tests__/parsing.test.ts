import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompletionsCreate = vi.fn();
const responsesCreate = vi.fn();

async function loadModules() {
  vi.doMock('../../../config/env.js', () => ({
    env: {
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'gpt-test',
    },
    hasOpenAI: true,
  }));

  vi.doMock('../client.js', () => ({
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    openai: {
      chat: {
        completions: {
          create: chatCompletionsCreate,
        },
      },
      responses: {
        create: responsesCreate,
      },
    },
  }));

  const metadataModule = await import('../metadata.js');
  const entitiesModule = await import('../entities.js');

  return { metadataModule, entitiesModule };
}

describe('OpenAI modules parsing path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('maps JSON metadata extraction response', async () => {
    chatCompletionsCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              sender: 'Alice',
              recipient: 'Bob',
              location_written: 'New York',
              hook: 'A short hook',
              summary: 'A summary',
              tags: ['family', 'travel'],
              extracted_date: '1942-05-01',
              extracted_date_confidence: 'exact',
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 12,
        total_tokens: 22,
      },
    });

    const { metadataModule } = await loadModules();
    const result = await metadataModule.extractMetadata({
      transcriptionText: 'Example transcript',
    });

    expect(result).toEqual({
      sender: 'Alice',
      recipient: 'Bob',
      locationWritten: 'New York',
      hook: 'A short hook',
      summary: 'A summary',
      tags: ['family', 'travel'],
      extractedDate: '1942-05-01',
      extractedDateConfidence: 'exact',
    });
  });

  it('throws on invalid V2 metadata JSON', async () => {
    responsesCreate.mockResolvedValue({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: '{invalid json' }],
        },
      ],
      usage: {
        input_tokens: 5,
        output_tokens: 4,
      },
    });

    const { metadataModule } = await loadModules();

    await expect(
      metadataModule.extractMetadataV2({
        transcriptionText: 'Example transcript',
      }),
    ).rejects.toThrow('Invalid JSON in V2 extraction response');
  });

  it('parses valid entity extraction response', async () => {
    responsesCreate.mockResolvedValue({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                people: [
                  {
                    name: 'Alice',
                    aliases: ['A.'],
                    role: 'sender',
                    relationship_to_sender: null,
                    details: [],
                    emotional_significance: null,
                    quotes: [],
                    confidence: 0.95,
                  },
                ],
                places: [
                  {
                    name: 'New York',
                    type: 'city',
                    role: 'written_from',
                    why_mentioned: 'Letter was written there',
                    descriptive_details: null,
                    associated_people: ['Alice'],
                    confidence: 0.9,
                  },
                ],
                relationships: [],
                person_place_connections: [
                  {
                    person_name: 'Alice',
                    place_name: 'New York',
                    connection_type: 'lives_in',
                    evidence: 'Says she is writing from New York',
                  },
                ],
              }),
            },
          ],
        },
      ],
      usage: {
        input_tokens: 9,
        output_tokens: 11,
      },
    });

    const { entitiesModule } = await loadModules();
    const result = await entitiesModule.extractEntities({
      transcriptionText: 'Example transcript',
    });

    expect(result.isStub).toBe(false);
    expect(result.entities.people).toHaveLength(1);
    expect(result.entities.places).toHaveLength(1);
    expect(result.entities.person_place_connections).toHaveLength(1);
    expect(result.usage).toEqual({
      promptTokens: 9,
      completionTokens: 11,
      totalTokens: 20,
    });
  });
});
