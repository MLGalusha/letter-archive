import { describe, expect, it } from 'vitest';
import {
  buildHumanEntityProvenancePatch,
  decideManualNameAutoLink,
  mapMetadataRelationshipToPersonRelationship,
  normalizeEntityName,
} from '../participant-sync.js';

describe('participant sync helpers', () => {
  it('switches manually edited entity content to one human-owned provenance tuple', () => {
    const confirmedAt = new Date('2026-07-23T12:00:00.000Z');

    expect(buildHumanEntityProvenancePatch('reviewer@example.test', confirmedAt)).toEqual({
      entityExtractionRevision: null,
      confirmedBy: 'reviewer@example.test',
      confirmedAt,
    });
  });

  describe('normalizeEntityName', () => {
    it('normalizes extra whitespace and trims boundaries', () => {
      expect(normalizeEntityName('  Mary   Jane  ')).toBe('Mary Jane');
    });

    it('returns null for empty input', () => {
      expect(normalizeEntityName('   ')).toBeNull();
      expect(normalizeEntityName(null)).toBeNull();
      expect(normalizeEntityName(undefined)).toBeNull();
    });
  });

  describe('decideManualNameAutoLink', () => {
    it('auto-links when best match is strong and separated', () => {
      const decision = decideManualNameAutoLink([
        { entityId: 'a', similarity: 97 },
        { entityId: 'b', similarity: 82 },
      ]);

      expect(decision).toEqual({
        mode: 'auto-link',
        selectedEntityId: 'a',
        reason: 'high-confidence',
        topSimilarity: 97,
      });
    });

    it('creates a new person when confidence is below strict threshold', () => {
      const decision = decideManualNameAutoLink([
        { entityId: 'a', similarity: 90 },
      ]);

      expect(decision.mode).toBe('create');
      expect(decision.reason).toBe('below-threshold');
    });

    it('creates a new person when top matches are too close', () => {
      const decision = decideManualNameAutoLink([
        { entityId: 'a', similarity: 96 },
        { entityId: 'b', similarity: 93 },
      ]);

      expect(decision.mode).toBe('create');
      expect(decision.reason).toBe('ambiguous');
    });
  });

  describe('mapMetadataRelationshipToPersonRelationship', () => {
    it('maps directed metadata relationships to graph-safe bidirectional types', () => {
      expect(mapMetadataRelationshipToPersonRelationship('parent')).toBe('parent-child');
      expect(mapMetadataRelationshipToPersonRelationship('child')).toBe('parent-child');
      expect(mapMetadataRelationshipToPersonRelationship('employer')).toBe('employer-employee');
      expect(mapMetadataRelationshipToPersonRelationship('employee')).toBe('employer-employee');
    });

    it('falls back to unknown for empty values', () => {
      expect(mapMetadataRelationshipToPersonRelationship(null)).toBe('unknown');
      expect(mapMetadataRelationshipToPersonRelationship(undefined)).toBe('unknown');
    });
  });
});
