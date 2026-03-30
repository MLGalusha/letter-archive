-- Update emotional_tone enum: remove 'neutral','desperate', add 'affectionate','grateful','matter-of-fact','nostalgic'
ALTER TYPE "emotional_tone" ADD VALUE IF NOT EXISTS 'affectionate';
ALTER TYPE "emotional_tone" ADD VALUE IF NOT EXISTS 'grateful';
ALTER TYPE "emotional_tone" ADD VALUE IF NOT EXISTS 'matter-of-fact';
ALTER TYPE "emotional_tone" ADD VALUE IF NOT EXISTS 'nostalgic';
-- Note: PostgreSQL does not support removing enum values. Old values ('neutral','desperate')
-- remain in the type but will no longer be assigned by the AI. Existing data is preserved.

-- Update relationship_type enum: add new values
ALTER TYPE "relationship_type" ADD VALUE IF NOT EXISTS 'parent-child';
ALTER TYPE "relationship_type" ADD VALUE IF NOT EXISTS 'extended-family';
ALTER TYPE "relationship_type" ADD VALUE IF NOT EXISTS 'professional';
ALTER TYPE "relationship_type" ADD VALUE IF NOT EXISTS 'institutional';
-- Note: Old values (fiancé/fiancée, parent, child, grandparent, grandchild, aunt/uncle,
-- nephew/niece, cousin, in-law, business-associate, employer, employee) remain in the type
-- but will no longer be assigned. Existing data is preserved.
