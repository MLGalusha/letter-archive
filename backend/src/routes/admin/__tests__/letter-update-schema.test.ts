import { describe, expect, it } from 'vitest';
import { updateLetterSchema } from '../letters/shared.js';

describe('admin letter update schema', () => {
  it('accepts the canonical reviewer metadata payload', () => {
    expect(updateLetterSchema.parse({
      primarySourceRevision: 4,
      extractedDate: '1947-09-21',
      emotionalTone: 'matter-of-fact',
      senderRecipientRelationship: 'parent-child',
      primaryTopics: ['family/separation-reunion', 'daily-life/household-social'],
    })).toEqual({
      primarySourceRevision: 4,
      extractedDate: '1947-09-21',
      emotionalTone: 'matter-of-fact',
      senderRecipientRelationship: 'parent-child',
      primaryTopics: ['family/separation-reunion', 'daily-life/household-social'],
    });
  });

  it('rejects non-canonical reviewer metadata values', () => {
    expect(updateLetterSchema.safeParse({
      emotionalTone: 'neutral',
      senderRecipientRelationship: 'parent',
      primaryTopics: ['family/separation'],
    }).success).toBe(false);
  });

  it('requires reviewer dates to use the ISO calendar form', () => {
    expect(updateLetterSchema.safeParse({
      extractedDate: 'September 21, 1947',
    }).success).toBe(false);
    expect(updateLetterSchema.safeParse({
      extractedDate: null,
    }).success).toBe(true);
  });
});
