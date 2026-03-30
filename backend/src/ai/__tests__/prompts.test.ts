import { describe, expect, it } from 'vitest';
import {
  TRANSCRIPTION_SYSTEM_PROMPT,
  PHOTO_DESCRIPTION_SYSTEM_PROMPT,
  METADATA_V2_SYSTEM_PROMPT,
  METADATA_UPDATE_SYSTEM_PROMPT,
  ENTITY_EXTRACTION_SYSTEM_PROMPT,
  buildTranscriptionUserPrompt,
  buildPhotoDescriptionPrompt,
  buildMetadataV2UserPrompt,
  buildMetadataUpdateUserPrompt,
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
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('"spouse"');
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('<controlled_vocabularies>');
  });

  it('builds photo description prompts with reviewer and linked-letter context blocks', () => {
    const prompt = buildPhotoDescriptionPrompt({
      collectionCode: '009',
      dateRaw: '19470000',
      photoNumber: 1,
      totalPhotos: 1,
      linkedLetterContext: 'Sender: Alice\nRecipient: Bob',
      reviewerContext: 'Likely Jimmy and Molly',
    });

    expect(prompt).toContain('<task>');
    expect(prompt).toContain('Collection: 009');
    expect(prompt).toContain('Date from filename: 19470000');
    expect(prompt).toContain('<linked_letter_context>');
    expect(prompt).toContain('Sender: Alice');
    expect(prompt).toContain('<reviewer_context>');
    expect(prompt).toContain('Likely Jimmy and Molly');
  });

  it('enforces truth-first hook and summary rules in metadata v2 prompt', () => {
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('If evidence is weak, set hook to null');
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('If confidence is too low to summarize faithfully, set summary to null');
    expect(METADATA_V2_SYSTEM_PROMPT).toContain('Hook/summary do not contain invented facts');
  });

  it('requires metadata update retagging to scan the full editable metadata surface', () => {
    expect(METADATA_UPDATE_SYSTEM_PROMPT).toContain('Scan the ENTIRE metadata JSON');
    expect(METADATA_UPDATE_SYSTEM_PROMPT).toContain('notable_quotes[].context');
    expect(METADATA_UPDATE_SYSTEM_PROMPT).toContain('ai_notes[].content');
    expect(METADATA_UPDATE_SYSTEM_PROMPT).toContain('Do NOT change direct quote text in notable_quotes[].text');
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

  it('builds metadata update prompt with explicit nested-field coverage instructions', () => {
    const prompt = buildMetadataUpdateUserPrompt({
      existingMetadata: {
        sender: 'Jimmie',
        recipient: 'Molly',
        hook: '«SENDER:Jimmie» writes to «RECIPIENT:Molly».',
        summary: '«SENDER:He» misses «RECIPIENT:her».',
        notable_quotes: [
          {
            text: 'Molly, Darling...',
            context: '«SENDER:Jimmie» addresses «RECIPIENT:Molly».',
            position: 'opening',
          },
        ],
        ai_notes: [
          {
            content: '«SENDER:Jimmie» appears in related material.',
            category: 'identity',
            priority: 'medium',
            resolves_when: null,
          },
        ],
      },
      senderName: 'Jimmy',
      recipientName: 'Molly',
      change: {
        field: 'sender',
        oldSender: 'Jimmie',
        newSender: 'Jimmy',
      },
    });

    expect(prompt).toContain('For the current schema, that includes: hook, summary, notable_quotes[].context, ai_notes[].content.');
    expect(prompt).toContain('If any additional prose string fields are present, update those too.');
    expect(prompt).toContain('Leave direct quote text in notable_quotes[].text');
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
    expect(PHOTO_DESCRIPTION_SYSTEM_PROMPT).toContain('Do NOT invent');
    expect(ENTITY_EXTRACTION_SYSTEM_PROMPT).toContain('NEVER fabricate information');
  });
});
