export const PERSISTED_EMOTIONAL_TONE_VALUES = [
  'joyful',
  'affectionate',
  'hopeful',
  'grateful',
  'matter-of-fact',
  'nostalgic',
  'anxious',
  'sad',
  'angry',
  // Legacy values remain valid in persisted letters and version history.
  'neutral',
  'desperate',
] as const;

export type PersistedEmotionalTone =
  typeof PERSISTED_EMOTIONAL_TONE_VALUES[number];

export const PERSISTED_RELATIONSHIP_TYPE_VALUES = [
  'spouse',
  'romantic-partner',
  'parent-child',
  'sibling',
  'extended-family',
  'friend',
  'acquaintance',
  'professional',
  'institutional',
  'unknown',
  // Legacy values remain valid in persisted letters and version history.
  'fiancé/fiancée',
  'parent',
  'child',
  'grandparent',
  'grandchild',
  'aunt/uncle',
  'nephew/niece',
  'cousin',
  'in-law',
  'business-associate',
  'employer',
  'employee',
] as const;

export type PersistedRelationshipType =
  typeof PERSISTED_RELATIONSHIP_TYPE_VALUES[number];
