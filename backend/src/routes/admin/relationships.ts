import { Router } from 'express';
import { z } from 'zod';
import {
  getAllRelationships,
  getRelationshipById,
  createRelationship,
  updateRelationship,
  deleteRelationship,
  getCanonicalPersonById,
} from '../../services/entities.js';
import { createLogger } from '../../utils/logger.js';
import type { PersonRelationshipType } from '../../db/schema.js';

const log = createLogger({ module: 'admin-relationships' });
const router = Router();

const relationshipTypes: PersonRelationshipType[] = [
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

const createRelationshipSchema = z.object({
  personAId: z.string().uuid(),
  personBId: z.string().uuid(),
  relationshipType: z.enum(relationshipTypes as [string, ...string[]]),
  notes: z.string().optional(),
  discoveredInLetterId: z.string().uuid().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

const updateRelationshipSchema = z.object({
  relationshipType: z.enum(relationshipTypes as [string, ...string[]]).optional(),
  notes: z.string().nullable().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

/**
 * GET /admin/relationships - Get all relationships for admin view
 */
router.get('/', async (_req, res, next) => {
  try {
    log.debug('Fetching all relationships for admin');
    const relationships = await getAllRelationships();

    res.json(
      relationships.map((r) => ({
        id: r.id,
        personAId: r.personAId,
        personBId: r.personBId,
        personAName: r.personAName,
        personBName: r.personBName,
        relationshipType: r.relationshipType,
        notes: r.notes,
        discoveredInLetterId: r.discoveredInLetterId,
        confidence: r.confidence,
        confirmedBy: r.confirmedBy,
        confirmedAt: r.confirmedAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/relationships/:id - Get a specific relationship
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    log.debug({ relationshipId: id }, 'Fetching relationship');

    const relationship = await getRelationshipById(id);
    if (!relationship) {
      res.status(404).json({ error: 'Relationship not found' });
      return;
    }

    res.json(relationship);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/relationships - Create a new relationship
 */
router.post('/', async (req, res, next) => {
  try {
    const parseResult = createRelationshipSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
      return;
    }

    const { personAId, personBId, relationshipType, notes, discoveredInLetterId, confidence } =
      parseResult.data;

    // Verify both persons exist
    const personA = await getCanonicalPersonById(personAId);
    const personB = await getCanonicalPersonById(personBId);

    if (!personA) {
      res.status(404).json({ error: `Person A not found: ${personAId}` });
      return;
    }
    if (!personB) {
      res.status(404).json({ error: `Person B not found: ${personBId}` });
      return;
    }

    if (personAId === personBId) {
      res.status(400).json({ error: 'Cannot create relationship between same person' });
      return;
    }

    log.info({ personAId, personBId, relationshipType }, 'Creating relationship');

    const id = await createRelationship({
      personAId,
      personBId,
      relationshipType: relationshipType as PersonRelationshipType,
      notes,
      discoveredInLetterId,
      confidence,
    });

    const created = await getRelationshipById(id);
    res.status(201).json(created);
  } catch (error) {
    // Handle unique constraint violation
    if ((error as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Relationship already exists between these people' });
      return;
    }
    next(error);
  }
});

/**
 * PUT /admin/relationships/:id - Update a relationship
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const parseResult = updateRelationshipSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
      return;
    }

    const existing = await getRelationshipById(id);
    if (!existing) {
      res.status(404).json({ error: 'Relationship not found' });
      return;
    }

    log.info({ relationshipId: id, updates: parseResult.data }, 'Updating relationship');

    await updateRelationship(id, {
      ...parseResult.data,
      relationshipType: parseResult.data.relationshipType as PersonRelationshipType | undefined,
    });

    const updated = await getRelationshipById(id);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/relationships/:id - Delete a relationship
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    log.info({ relationshipId: id }, 'Deleting relationship');

    const existing = await getRelationshipById(id);
    if (!existing) {
      res.status(404).json({ error: 'Relationship not found' });
      return;
    }

    await deleteRelationship(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
