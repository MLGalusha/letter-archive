import { Router } from 'express';
import { z } from 'zod';
import {
  getAllPersonsWithCounts,
  getAllPlacesWithCounts,
  getCanonicalPersonById,
  getCanonicalPlaceById,
  createCanonicalPerson,
  createCanonicalPlace,
  updateCanonicalPerson,
  updateCanonicalPlace,
  mergePersons,
  getLettersForPerson,
  getLettersForPlace,
  getPendingReviewItems,
  resolveReviewItem,
  getReviewQueueStats,
  findMatchingPersons,
  findMatchingPlaces,
  // Relationship functions
  getAllRelationships,
  getRelationshipsForPerson,
  getRelationshipById,
  createRelationship,
  updateRelationship,
  deleteRelationship,
} from '../../services/entities.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'admin-entities' });
const router = Router();

// ============================================================================
// PERSONS ENDPOINTS
// ============================================================================

/**
 * GET /admin/entities/persons - List all persons with letter counts
 */
router.get('/persons', async (req, res, next) => {
  try {
    const persons = await getAllPersonsWithCounts();
    res.json({ persons });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/persons/search - Search persons by name (fuzzy)
 */
router.get('/persons/search', async (req, res, next) => {
  try {
    const query = z.string().min(1).parse(req.query.q);
    const matches = await findMatchingPersons(query);
    res.json({ matches });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/persons/:id - Get person detail with related letters
 */
router.get('/persons/:id', async (req, res, next) => {
  try {
    const person = await getCanonicalPersonById(req.params.id);
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    const letters = await getLettersForPerson(req.params.id);
    res.json({ person, letters });
  } catch (error) {
    next(error);
  }
});

const createPersonSchema = z.object({
  canonicalName: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

/**
 * POST /admin/entities/persons - Create new person
 */
router.post('/persons', async (req, res, next) => {
  try {
    const data = createPersonSchema.parse(req.body);
    const id = await createCanonicalPerson(data);
    const person = await getCanonicalPersonById(id);
    res.status(201).json({ person });
  } catch (error) {
    next(error);
  }
});

const updatePersonSchema = z.object({
  canonicalName: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * PUT /admin/entities/persons/:id - Update person
 */
router.put('/persons/:id', async (req, res, next) => {
  try {
    const data = updatePersonSchema.parse(req.body);
    await updateCanonicalPerson(req.params.id, data);
    const person = await getCanonicalPersonById(req.params.id);
    res.json({ person });
  } catch (error) {
    next(error);
  }
});

const mergePersonsSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid(),
});

/**
 * POST /admin/entities/persons/merge - Merge two persons
 */
router.post('/persons/merge', async (req, res, next) => {
  try {
    const { keepId, mergeId } = mergePersonsSchema.parse(req.body);
    await mergePersons(keepId, mergeId);
    const person = await getCanonicalPersonById(keepId);
    res.json({ person, message: 'Persons merged successfully' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PLACES ENDPOINTS
// ============================================================================

/**
 * GET /admin/entities/places - List all places with letter counts
 */
router.get('/places', async (req, res, next) => {
  try {
    const places = await getAllPlacesWithCounts();
    res.json({ places });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/places/search - Search places by name (fuzzy)
 */
router.get('/places/search', async (req, res, next) => {
  try {
    const query = z.string().min(1).parse(req.query.q);
    const matches = await findMatchingPlaces(query);
    res.json({ matches });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/places/:id - Get place detail with related letters
 */
router.get('/places/:id', async (req, res, next) => {
  try {
    const place = await getCanonicalPlaceById(req.params.id);
    if (!place) {
      res.status(404).json({ error: 'Place not found' });
      return;
    }

    const letters = await getLettersForPlace(req.params.id);
    res.json({ place, letters });
  } catch (error) {
    next(error);
  }
});

const createPlaceSchema = z.object({
  canonicalName: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  placeType: z.enum(['city', 'region', 'country', 'street', 'landmark', 'other']).optional(),
  notes: z.string().optional(),
});

/**
 * POST /admin/entities/places - Create new place
 */
router.post('/places', async (req, res, next) => {
  try {
    const data = createPlaceSchema.parse(req.body);
    const id = await createCanonicalPlace(data);
    const place = await getCanonicalPlaceById(id);
    res.status(201).json({ place });
  } catch (error) {
    next(error);
  }
});

const updatePlaceSchema = z.object({
  canonicalName: z.string().min(1).optional(),
  aliases: z.array(z.string()).optional(),
  placeType: z.enum(['city', 'region', 'country', 'street', 'landmark', 'other']).nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * PUT /admin/entities/places/:id - Update place
 */
router.put('/places/:id', async (req, res, next) => {
  try {
    const data = updatePlaceSchema.parse(req.body);
    await updateCanonicalPlace(req.params.id, data);
    const place = await getCanonicalPlaceById(req.params.id);
    res.json({ place });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// REVIEW QUEUE ENDPOINTS
// ============================================================================

/**
 * GET /admin/entities/review - Get review queue items
 */
router.get('/review', async (req, res, next) => {
  try {
    const entityType = req.query.type as 'person' | 'place' | undefined;
    const items = await getPendingReviewItems(entityType);
    const stats = await getReviewQueueStats();
    res.json({ items, stats });
  } catch (error) {
    next(error);
  }
});

const resolveReviewSchema = z.object({
  status: z.enum(['confirmed', 'rejected', 'new_entity']),
  reviewedBy: z.string().default('admin'),
});

/**
 * POST /admin/entities/review/:id/resolve - Resolve a review item
 */
router.post('/review/:id/resolve', async (req, res, next) => {
  try {
    const data = resolveReviewSchema.parse(req.body);
    await resolveReviewItem(req.params.id, data);
    res.json({ message: 'Review item resolved' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// RELATIONSHIP ENDPOINTS
// ============================================================================

const relationshipTypes = [
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
] as const;

/**
 * GET /admin/entities/relationships - List all relationships
 */
router.get('/relationships', async (req, res, next) => {
  try {
    const relationships = await getAllRelationships();
    res.json({ relationships });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/relationships/person/:personId - Get relationships for a person
 */
router.get('/relationships/person/:personId', async (req, res, next) => {
  try {
    const relationships = await getRelationshipsForPerson(req.params.personId);
    res.json({ relationships });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/relationships/:id - Get a single relationship
 */
router.get('/relationships/:id', async (req, res, next) => {
  try {
    const relationship = await getRelationshipById(req.params.id);
    if (!relationship) {
      res.status(404).json({ error: 'Relationship not found' });
      return;
    }
    res.json({ relationship });
  } catch (error) {
    next(error);
  }
});

const createRelationshipSchema = z.object({
  personAId: z.string().uuid(),
  personBId: z.string().uuid(),
  relationshipType: z.enum(relationshipTypes),
  notes: z.string().optional(),
  discoveredInLetterId: z.string().uuid().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

/**
 * POST /admin/entities/relationships - Create a new relationship
 */
router.post('/relationships', async (req, res, next) => {
  try {
    const data = createRelationshipSchema.parse(req.body);
    const id = await createRelationship(data);
    const relationship = await getRelationshipById(id);
    res.status(201).json({ relationship });
  } catch (error) {
    next(error);
  }
});

const updateRelationshipSchema = z.object({
  relationshipType: z.enum(relationshipTypes).optional(),
  notes: z.string().nullable().optional(),
  confidence: z.number().min(0).max(100).optional(),
});

/**
 * PUT /admin/entities/relationships/:id - Update a relationship
 */
router.put('/relationships/:id', async (req, res, next) => {
  try {
    const data = updateRelationshipSchema.parse(req.body);
    await updateRelationship(req.params.id, data);
    const relationship = await getRelationshipById(req.params.id);
    res.json({ relationship });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/entities/relationships/:id - Delete a relationship
 */
router.delete('/relationships/:id', async (req, res, next) => {
  try {
    await deleteRelationship(req.params.id);
    res.json({ message: 'Relationship deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;
