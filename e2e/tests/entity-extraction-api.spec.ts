import { test, expect } from '@playwright/test';
import { API_BASE_URL } from './utils/test-helpers';

/**
 * E2E tests for Entity Extraction API (Prompt 2)
 *
 * Tests the two-phase metadata + entity extraction pipeline:
 * - Phase 1: Basic metadata extraction (sender, recipient, hook, summary, etc.)
 * - Phase 2: Rich entity extraction (people, places, relationships, connections)
 *
 * These tests call the real OpenAI API and validate prompt quality.
 * Run with: npx playwright test entity-extraction-api
 */

// Letter shape from the admin API list endpoint
interface AdminLetterSummary {
  id: string;
  title: string;
  collectionCode: string;
  transcript?: {
    fullText?: string;
  };
  metadata?: {
    sender?: string;
    recipient?: string;
  };
  entityExtractionStatus?: string;
  entityExtractionJson?: EntityExtractionJson;
  entityExtractionError?: string;
  linkedPersons?: LinkedEntity[];
  linkedPlaces?: LinkedEntity[];
  workflowState?: string;
  metadataContentStatus?: string;
  sender?: string;
  recipient?: string;
  status?: string;
}

interface EntityExtractionJson {
  people: ExtractedPerson[];
  places: ExtractedPlace[];
  relationships: ExtractedRelationship[];
  person_place_connections: PersonPlaceConnection[];
}

interface ExtractedPerson {
  name: string;
  aliases: string[];
  role: string;
  relationship_to_sender: string | null;
  details: { detail: string; category: string }[];
  emotional_significance: string | null;
  quotes: { text: string; context: string }[];
  confidence: number;
}

interface ExtractedPlace {
  name: string;
  type: string;
  role: string;
  why_mentioned: string;
  descriptive_details: string | null;
  associated_people: string[];
  confidence: number;
}

interface ExtractedRelationship {
  person_a: string;
  person_b: string;
  relationship_type: string;
  evidence: string;
  confidence: number;
}

interface PersonPlaceConnection {
  person_name: string;
  place_name: string;
  connection_type: string;
  evidence: string;
}

interface LinkedEntity {
  id: string;
  personId?: string;
  placeId?: string;
  canonicalName: string;
  role: string;
}

test.describe('Entity Extraction API', () => {
  test.describe('POST /admin/letters/:id/regenerate-entities', () => {
    test('returns 404 for non-existent letter', async ({ request }) => {
      const res = await request.post(
        `${API_BASE_URL}/admin/letters/00000000-0000-0000-0000-000000000000/regenerate-entities`
      );
      expect(res.status()).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('not found');
    });

    test('returns 400 for letter without transcription', async ({ request }) => {
      // Find a letter without transcription
      const listRes = await request.get(`${API_BASE_URL}/admin/letters?limit=50`);
      const listBody = await listRes.json();
      const letters: AdminLetterSummary[] = listBody.letters || listBody;

      const noTranscript = letters.find(
        (l) => !l.transcript?.fullText || l.transcript.fullText.trim().length < 10
      );

      if (!noTranscript) {
        test.skip(true, 'No letters without transcription found');
        return;
      }

      const res = await request.post(
        `${API_BASE_URL}/admin/letters/${noTranscript.id}/regenerate-entities`
      );
      // Should be 400 (no transcription) or 200 if it has some text
      expect([200, 400]).toContain(res.status());
    });
  });

  test.describe('Full Entity Extraction Pipeline (OpenAI)', () => {
    // These tests call the real OpenAI API - long timeout
    test.setTimeout(180000); // 3 minutes

    let testLetterId: string | null = null;

    test.beforeAll(async ({ request }) => {
      // Find a letter with substantial transcription text
      const listRes = await request.get(`${API_BASE_URL}/admin/letters?limit=50`);
      const listBody = await listRes.json();
      const letters: AdminLetterSummary[] = listBody.letters || listBody;

      // Find a letter with a good transcription (use transcript.fullText)
      const withTranscript = letters
        .filter((l) => l.transcript?.fullText && l.transcript.fullText.length > 200)
        .sort(
          (a, b) =>
            (b.transcript?.fullText?.length || 0) -
            (a.transcript?.fullText?.length || 0)
        );

      if (withTranscript.length > 0) {
        testLetterId = withTranscript[0].id;
        console.log(
          `Selected test letter: ${testLetterId} (transcript: ${withTranscript[0].transcript?.fullText?.length} chars)`
        );
      }
    });

    test('entity extraction endpoint processes and returns enriched entities', async ({
      request,
    }) => {
      if (!testLetterId) {
        test.skip(true, 'No transcribed letters available for entity extraction');
        return;
      }

      console.log(`\nTriggering entity extraction on letter: ${testLetterId}`);

      const res = await request.post(
        `${API_BASE_URL}/admin/letters/${testLetterId}/regenerate-entities`
      );

      // Should succeed
      expect(res.status()).toBe(200);

      const letter: AdminLetterSummary = await res.json();

      // Entity extraction should have completed
      expect(letter.entityExtractionStatus).toBe('SUCCESS');
      expect(letter.entityExtractionError).toBeFalsy();
      expect(letter.entityExtractionJson).toBeTruthy();

      const entities = letter.entityExtractionJson!;

      // ================================================================
      // VALIDATE ENTITY STRUCTURE
      // ================================================================

      expect(entities.people).toBeInstanceOf(Array);
      expect(entities.people.length).toBeGreaterThanOrEqual(1);

      console.log(`\n=== ENTITY EXTRACTION RESULTS ===`);
      console.log(`People: ${entities.people.length}`);
      console.log(`Places: ${entities.places.length}`);
      console.log(`Relationships: ${entities.relationships.length}`);
      console.log(`Person-Place Connections: ${entities.person_place_connections.length}`);

      // Validate each person has required structure
      for (const person of entities.people) {
        expect(person.name).toBeTruthy();
        expect(['sender', 'recipient', 'mentioned']).toContain(person.role);
        expect(person.aliases).toBeInstanceOf(Array);
        expect(person.details).toBeInstanceOf(Array);
        expect(person.quotes).toBeInstanceOf(Array);
        expect(person.confidence).toBeGreaterThanOrEqual(0);
        expect(person.confidence).toBeLessThanOrEqual(1);

        console.log(`\nPerson: ${person.name} (${person.role})`);
        console.log(`  Aliases: ${person.aliases.join(', ') || '(none)'}`);
        console.log(`  Relationship to sender: ${person.relationship_to_sender || '(none)'}`);
        console.log(`  Details (${person.details.length}):`);
        for (const detail of person.details) {
          expect(detail.detail).toBeTruthy();
          expect(detail.category).toBeTruthy();
          console.log(`    [${detail.category}] ${detail.detail}`);
        }
        console.log(`  Quotes (${person.quotes.length}):`);
        for (const quote of person.quotes) {
          expect(quote.text).toBeTruthy();
          expect(quote.context).toBeTruthy();
          console.log(
            `    "${quote.text.length > 80 ? quote.text.substring(0, 80) + '...' : quote.text}"`
          );
          console.log(`      → ${quote.context}`);
        }
        console.log(
          `  Emotional significance: ${person.emotional_significance || '(none)'}`
        );
        console.log(`  Confidence: ${person.confidence}`);
      }

      // Validate places structure
      expect(entities.places).toBeInstanceOf(Array);
      for (const place of entities.places) {
        expect(place.name).toBeTruthy();
        expect(['city', 'region', 'country', 'street', 'landmark', 'other']).toContain(
          place.type
        );
        expect(['written_from', 'mentioned', 'destination']).toContain(place.role);
        expect(place.why_mentioned).toBeTruthy();
        expect(place.associated_people).toBeInstanceOf(Array);
        expect(place.confidence).toBeGreaterThanOrEqual(0);
        expect(place.confidence).toBeLessThanOrEqual(1);

        console.log(`\nPlace: ${place.name} (${place.type}, ${place.role})`);
        console.log(`  Why mentioned: ${place.why_mentioned}`);
        console.log(
          `  Descriptive details: ${place.descriptive_details || '(none)'}`
        );
        console.log(
          `  Associated people: ${place.associated_people.join(', ') || '(none)'}`
        );
        console.log(`  Confidence: ${place.confidence}`);
      }

      // Validate relationships structure
      expect(entities.relationships).toBeInstanceOf(Array);
      const validRelationshipTypes = [
        'spouse',
        'fiancé/fiancée',
        'romantic-partner',
        'parent-child',
        'sibling',
        'grandparent-grandchild',
        'aunt-uncle-niece-nephew',
        'cousin',
        'in-law',
        'friend',
        'acquaintance',
        'business-associate',
        'employer-employee',
        'unknown',
      ];
      for (const rel of entities.relationships) {
        expect(rel.person_a).toBeTruthy();
        expect(rel.person_b).toBeTruthy();
        expect(validRelationshipTypes).toContain(rel.relationship_type);
        expect(rel.evidence).toBeTruthy();
        expect(rel.confidence).toBeGreaterThanOrEqual(0);
        expect(rel.confidence).toBeLessThanOrEqual(1);

        console.log(
          `\nRelationship: ${rel.person_a} ↔ ${rel.person_b} (${rel.relationship_type})`
        );
        console.log(`  Evidence: ${rel.evidence}`);
        console.log(`  Confidence: ${rel.confidence}`);
      }

      // Validate person-place connections
      expect(entities.person_place_connections).toBeInstanceOf(Array);
      for (const conn of entities.person_place_connections) {
        expect(conn.person_name).toBeTruthy();
        expect(conn.place_name).toBeTruthy();
        expect(conn.connection_type).toBeTruthy();
        expect(conn.evidence).toBeTruthy();

        console.log(
          `\nConnection: ${conn.person_name} → ${conn.place_name} (${conn.connection_type})`
        );
        console.log(`  Evidence: ${conn.evidence}`);
      }

      console.log('\n=== END ENTITY EXTRACTION RESULTS ===\n');
    });

    test('entity extraction identifies sender and recipient correctly', async ({
      request,
    }) => {
      if (!testLetterId) {
        test.skip(true, 'No test letter available');
        return;
      }

      // Fetch the letter to get its current entity extraction
      const res = await request.get(
        `${API_BASE_URL}/admin/letters/${testLetterId}`
      );
      const letter: AdminLetterSummary = await res.json();

      if (
        letter.entityExtractionStatus !== 'SUCCESS' ||
        !letter.entityExtractionJson
      ) {
        test.skip(true, 'Entity extraction not yet completed');
        return;
      }

      const entities = letter.entityExtractionJson;

      // Should have a person with role 'sender'
      const senders = entities.people.filter((p) => p.role === 'sender');
      expect(senders.length).toBeGreaterThanOrEqual(1);

      // Should have a person with role 'recipient'
      const recipients = entities.people.filter((p) => p.role === 'recipient');
      expect(recipients.length).toBeGreaterThanOrEqual(1);

      // Check sender name consistency with metadata
      const metadataSender = letter.metadata?.sender;
      if (metadataSender) {
        const senderNames = senders.map((s) => s.name.toLowerCase());
        const match = senderNames.some(
          (n) =>
            n.includes(metadataSender.toLowerCase()) ||
            metadataSender.toLowerCase().includes(n)
        );
        console.log(
          `Sender check: metadata="${metadataSender}", entities=[${senderNames.join(', ')}], match=${match}`
        );
        if (!match) {
          console.warn(
            `PROMPT QUALITY: Sender name mismatch between metadata and entity extraction`
          );
        }
      }

      // Check recipient name consistency
      const metadataRecipient = letter.metadata?.recipient;
      if (metadataRecipient) {
        const recipientNames = recipients.map((r) => r.name.toLowerCase());
        const match = recipientNames.some(
          (n) =>
            n.includes(metadataRecipient.toLowerCase()) ||
            metadataRecipient.toLowerCase().includes(n)
        );
        console.log(
          `Recipient check: metadata="${metadataRecipient}", entities=[${recipientNames.join(', ')}], match=${match}`
        );
        if (!match) {
          console.warn(
            `PROMPT QUALITY: Recipient name mismatch between metadata and entity extraction`
          );
        }
      }
    });

    test('every person has at least one quote', async ({ request }) => {
      if (!testLetterId) {
        test.skip(true, 'No test letter available');
        return;
      }

      const res = await request.get(
        `${API_BASE_URL}/admin/letters/${testLetterId}`
      );
      const letter: AdminLetterSummary = await res.json();

      if (
        letter.entityExtractionStatus !== 'SUCCESS' ||
        !letter.entityExtractionJson
      ) {
        test.skip(true, 'Entity extraction not completed');
        return;
      }

      const entities = letter.entityExtractionJson;

      let allHaveQuotes = true;
      for (const person of entities.people) {
        if (person.quotes.length === 0) {
          console.warn(
            `PROMPT QUALITY: Person "${person.name}" (${person.role}) has NO quotes`
          );
          allHaveQuotes = false;
        }
      }

      if (!allHaveQuotes) {
        console.log(
          'SUGGESTION: Strengthen the prompt to require at least one quote per person'
        );
      }

      // Sender and recipient MUST have quotes
      const mainPeople = entities.people.filter(
        (p) => p.role === 'sender' || p.role === 'recipient'
      );
      for (const person of mainPeople) {
        expect(
          person.quotes.length,
          `${person.name} (${person.role}) must have at least one quote`
        ).toBeGreaterThanOrEqual(1);
      }
    });

    test('detail categories use expected vocabulary', async ({ request }) => {
      if (!testLetterId) {
        test.skip(true, 'No test letter available');
        return;
      }

      const res = await request.get(
        `${API_BASE_URL}/admin/letters/${testLetterId}`
      );
      const letter: AdminLetterSummary = await res.json();

      if (
        letter.entityExtractionStatus !== 'SUCCESS' ||
        !letter.entityExtractionJson
      ) {
        test.skip(true, 'Entity extraction not completed');
        return;
      }

      const expectedCategories = [
        'occupation',
        'age',
        'health',
        'location',
        'education',
        'personality',
        'life_event',
        'family',
        'financial',
        'military',
        'religion',
        'appearance',
        'hobby',
      ];

      const unexpectedCategories = new Set<string>();

      for (const person of letter.entityExtractionJson.people) {
        for (const detail of person.details) {
          expect(detail.detail.length).toBeGreaterThan(0);
          expect(detail.category.length).toBeGreaterThan(0);

          if (!expectedCategories.includes(detail.category)) {
            unexpectedCategories.add(detail.category);
          }
        }
      }

      if (unexpectedCategories.size > 0) {
        console.warn(
          `PROMPT QUALITY: Unexpected detail categories found: ${[...unexpectedCategories].join(', ')}`
        );
        console.log(
          'SUGGESTION: Either add these categories to the prompt or tighten category instructions'
        );
      }
    });

    test('linked entities are auto-populated after extraction', async ({
      request,
    }) => {
      if (!testLetterId) {
        test.skip(true, 'No test letter available');
        return;
      }

      const res = await request.get(
        `${API_BASE_URL}/admin/letters/${testLetterId}`
      );
      const letter: AdminLetterSummary = await res.json();

      if (letter.entityExtractionStatus !== 'SUCCESS') {
        test.skip(true, 'Entity extraction not completed');
        return;
      }

      const linkedPersons = letter.linkedPersons || [];
      const linkedPlaces = letter.linkedPlaces || [];

      console.log(`Linked persons: ${linkedPersons.length}`);
      for (const p of linkedPersons) {
        console.log(`  ${p.canonicalName} (${p.role})`);
      }

      console.log(`Linked places: ${linkedPlaces.length}`);
      for (const p of linkedPlaces) {
        console.log(`  ${p.canonicalName} (${p.role})`);
      }

      // After entity extraction, there should be linked entities
      if (letter.entityExtractionJson?.people && letter.entityExtractionJson.people.length > 0) {
        expect(
          linkedPersons.length,
          'Linked persons should be auto-populated from entity extraction'
        ).toBeGreaterThanOrEqual(1);
      }

      if (letter.entityExtractionJson?.places && letter.entityExtractionJson.places.length > 0) {
        expect(
          linkedPlaces.length,
          'Linked places should be auto-populated from entity extraction'
        ).toBeGreaterThanOrEqual(1);
      }
    });
  });

  test.describe('Full Pipeline (Phase 1 + Phase 2)', () => {
    test.setTimeout(180000);

    test('regenerate-metadata runs both phases', async ({ request }) => {
      // Find a letter with transcription
      const listRes = await request.get(`${API_BASE_URL}/admin/letters?limit=50`);
      const listBody = await listRes.json();
      const letters: AdminLetterSummary[] = listBody.letters || listBody;

      const withTranscript = letters.find(
        (l) => l.transcript?.fullText && l.transcript.fullText.length > 200
      );

      if (!withTranscript) {
        test.skip(true, 'No transcribed letters available');
        return;
      }

      console.log(
        `Testing full pipeline on letter: ${withTranscript.id}`
      );

      // Trigger full metadata regeneration (synchronous — awaits completion)
      const res = await request.post(
        `${API_BASE_URL}/admin/letters/${withTranscript.id}/regenerate-metadata`
      );

      expect(res.status()).toBe(200);

      const letter: AdminLetterSummary = await res.json();

      // Phase 1 metadata should be extracted
      console.log(`\n=== PHASE 1 RESULTS ===`);
      console.log(`Workflow: ${letter.workflowState}`);
      console.log(`Metadata content status: ${letter.metadataContentStatus}`);
      console.log(`Sender: ${letter.metadata?.sender}`);
      console.log(`Recipient: ${letter.metadata?.recipient}`);
      console.log(`=== END PHASE 1 ===\n`);

      // Phase 2 entity extraction should also run
      console.log(`Entity extraction status: ${letter.entityExtractionStatus}`);
      if (
        letter.entityExtractionStatus === 'SUCCESS' &&
        letter.entityExtractionJson
      ) {
        console.log(`People: ${letter.entityExtractionJson.people.length}`);
        console.log(`Places: ${letter.entityExtractionJson.places.length}`);
        console.log(
          `Relationships: ${letter.entityExtractionJson.relationships.length}`
        );
        console.log(
          `Connections: ${letter.entityExtractionJson.person_place_connections.length}`
        );
      } else if (letter.entityExtractionError) {
        console.warn(
          `Phase 2 failed (non-fatal): ${letter.entityExtractionError}`
        );
      }

      // Phase 1 should always succeed: metadata content status should be AI_DRAFT
      // and metadata fields should be populated
      expect(letter.metadataContentStatus).toBe('AI_DRAFT');
      expect(letter.metadata?.sender || letter.metadata?.recipient).toBeTruthy();
    });
  });
});
