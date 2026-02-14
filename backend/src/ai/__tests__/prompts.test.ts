import { describe, expect, it } from 'vitest';
import {
  TRANSCRIPTION_SYSTEM_PROMPT,
  METADATA_V2_SYSTEM_PROMPT,
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  buildTranscriptionUserPrompt,
  buildMetadataV2UserPrompt,
  buildEntityExtractionUserPrompt,
} from '../prompts.js';

describe('AI prompt builders', () => {
  it('builds transcription prompt with optional context', () => {
    const prompt = buildTranscriptionUserPrompt({
      collectionCode: '003',
      dateRaw: '19470921',
      pageNumber: 1,
      totalPages: 3,
    });

    expect(prompt).toContain('Please transcribe this handwritten document image.');
    expect(prompt).toContain('Collection: 003');
    expect(prompt).toContain('Date from filename: 19470921');
    expect(prompt).toContain('Page 1 of 3');
  });

  it('keeps controlled vocabulary anchors in metadata v2 system prompt', () => {
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('"romantic-partner"');
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('"fiancé/fiancée"');
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('"spouse"');
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('COMMON MISTAKES TO AVOID');
  });

  it('builds metadata v2 prompt with extra content and context blocks', () => {
    const prompt = buildMetadataV2UserPrompt('Letter text', {
      collectionCode: '007',
      dateRaw: '19421001',
      dateFromFilename: '1942-10-01',
      extraContentTranscript: 'Envelope note text',
    });

    expect(prompt).toContain('<letter_transcription>');
    expect(prompt).toContain('Letter text');
    expect(prompt).toContain('<extra_content>');
    expect(prompt).toContain('Envelope note text');
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('Collection: 007');
    expect(prompt).toContain('Parsed date from filename: 1942-10-01');
  });

  it('builds entity extraction prompt with prior metadata context', () => {
    const prompt = buildEntityExtractionUserPrompt(
      'Main transcript',
      {
        sender: 'Alice',
        recipient: 'Bob',
        senderRecipientRelationship: 'friend',
        summary: 'Short summary',
      },
      {
        collectionCode: '009',
        dateRaw: '19300102',
        extraContentTranscript: 'Telegram excerpt',
      },
    );

    expect(ENTITY_EXTRACTION_SYSTEM_PROMPT).toContain('Use EXACTLY these relationship types');
    expect(prompt).toContain('<basic_metadata>');
    expect(prompt).toContain('Sender: Alice');
    expect(prompt).toContain('Recipient: Bob');
    expect(prompt).toContain('Sender-Recipient Relationship: friend');
    expect(prompt).toContain('<extra_content>');
    expect(prompt).toContain('Telegram excerpt');
    expect(prompt).toContain('Extract all people, places, relationships');
  });

  it('exposes hard safety rules in system prompts', () => {
    expect(TRANSCRIPTION_SYSTEM_PROMPT).toContain('DO NOT fabricate');
    expect(ENTITY_EXTRACTION_SYSTEM_PROMPT).toContain('NEVER fabricate information');
  });
});
