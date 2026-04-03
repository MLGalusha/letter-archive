import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env.js', () => ({
  env: {
    OPENAI_API_KEY: '',
    OPENAI_MODEL: 'gpt-test',
  },
  hasOpenAI: false,
}));

let transcriptionModule: typeof import('../transcription.js');
let metadataModule: typeof import('../metadata.js');
let entitiesModule: typeof import('../entities.js');

beforeAll(async () => {
  transcriptionModule = await import('../transcription.js');
  metadataModule = await import('../metadata.js');
  entitiesModule = await import('../entities.js');
});

describe('OpenAI modules stub mode', () => {
  it('returns stub transcription for letter images', async () => {
    const result = await transcriptionModule.transcribeImage({
      filePath: '/tmp/test-letter.jpg',
      context: { collectionCode: '001', pageNumber: 1 },
    });

    expect(result.isStub).toBe(true);
    expect(result.text).toBeTruthy();
    expect(result.structured).toBeTruthy();
    expect(Array.isArray(result.structured)).toBe(true);
  });

  it('returns stub metadata for v2 extraction', async () => {
    const v2 = await metadataModule.extractMetadataV2({
      transcriptionText: '[STUB TRANSCRIPTION - test]',
    });
    expect(v2.isStub).toBe(true);
    expect(v2.metadata.sender).toBe('Unknown (stub)');
    expect(v2.metadata.emotional_tone).toBe('matter-of-fact');
  });

  it('returns empty stub entity extraction', async () => {
    const result = await entitiesModule.extractEntities({
      transcriptionText: 'example text',
    });

    expect(result.isStub).toBe(true);
    expect(result.entities.people).toHaveLength(0);
    expect(result.entities.places).toHaveLength(0);
    expect(result.entities.relationships).toHaveLength(0);
    expect(result.entities.person_place_connections).toHaveLength(0);
  });

  it('returns stub extra-content checks and transcription', async () => {
    const check = await transcriptionModule.checkExtraContentForText({
      filePath: '/tmp/extra.jpg',
      documentType: 'envelope',
    });
    expect(check.isStub).toBe(true);
    expect(check.hasTranscribableText).toBe(true);

    const transcribed = await transcriptionModule.transcribeExtraContent({
      filePath: '/tmp/extra.jpg',
      documentType: 'envelope',
    });
    expect(transcribed.isStub).toBe(true);
    expect(transcribed.text).toContain('[STUB EXTRA CONTENT TRANSCRIPTION]');
  });
});
