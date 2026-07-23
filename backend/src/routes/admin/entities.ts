import { Router } from 'express';
import { z } from 'zod';
import {
  getAllPersonsWithCounts,
  getAllPlacesWithCounts,
  getCanonicalPersonById,
  getCanonicalPlaceById,
  createCanonicalPerson,
  createCanonicalPlace,
  updateCanonicalPersonWithUndo,
  updateCanonicalPlaceWithUndo,
  mergePersonsWithUndo,
  mergePlacesWithUndo,
  undoPersonRename,
  undoPersonMerge,
  undoPlaceRename,
  undoPlaceMerge,
  generatePlaceThemes,
  extractPlaceThemesFromNotes,
  getLettersForPersonEnriched,
  getLettersForPlaceEnriched,
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
  buildHumanEntityProvenancePatch,
  // Phase 5: Merge enhancements
  findPotentialDuplicatePersons,
  findPotentialDuplicatePlaces,
  bulkMergePersons,
  bulkMergePlaces,
  getPersonDetailsForMerge,
  getPlaceDetailsForMerge,
  getSameNamePersonCandidates,
  getSameNamePlaceCandidates,
} from '../../services/entities.js';
import { updatePersonBiography, type BiographyUpdateData } from '../../services/biography.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'admin-entities' });
const router = Router();

// ============================================================================
// DUPLICATE SUGGESTIONS ENDPOINTS
// ============================================================================

/**
 * GET /admin/entities/suggestions - Get AI-suggested potential duplicates
 * Query params:
 *   - entityType: 'person' | 'place' (required)
 *   - limit: number (optional, default 20)
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    const entityType = z.enum(['person', 'place']).parse(req.query.entityType);
    const limit = z.coerce.number().min(1).max(100).optional().parse(req.query.limit) ?? 20;

    const suggestions = entityType === 'person'
      ? await findPotentialDuplicatePersons(limit)
      : await findPotentialDuplicatePlaces(limit);

    res.json({ suggestions });
  } catch (error) {
    next(error);
  }
});

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
 * GET /admin/entities/persons/:id - Get person detail with related letters and relationships
 */
router.get('/persons/:id', async (req, res, next) => {
  try {
    const person = await getCanonicalPersonById(req.params.id);
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    const letters = await getLettersForPersonEnriched(req.params.id);
    const relationships = await getRelationshipsForPerson(req.params.id);
    res.json({ person, letters, relationships });
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
    const { undoActionId } = await updateCanonicalPersonWithUndo(req.params.id, data);
    const person = await getCanonicalPersonById(req.params.id);
    res.json({ person, undoActionId });
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
    const { undoActionId } = await mergePersonsWithUndo(keepId, mergeId);
    const person = await getCanonicalPersonById(keepId);
    res.json({ person, message: 'Persons merged successfully', undoActionId });
  } catch (error) {
    next(error);
  }
});

const bulkMergePersonsSchema = z.object({
  keepId: z.string().uuid(),
  mergeIds: z.array(z.string().uuid()).min(1),
});

/**
 * POST /admin/entities/persons/bulk-merge - Merge multiple persons into one
 */
router.post('/persons/bulk-merge', async (req, res, next) => {
  try {
    const { keepId, mergeIds } = bulkMergePersonsSchema.parse(req.body);
    await bulkMergePersons(keepId, mergeIds);
    const person = await getCanonicalPersonById(keepId);
    res.json({ person, message: `${mergeIds.length} persons merged successfully` });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/persons/:id/merge-details - Get detailed info for merge comparison
 */
router.get('/persons/:id/merge-details', async (req, res, next) => {
  try {
    const details = await getPersonDetailsForMerge(req.params.id);
    if (!details) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }
    res.json(details);
  } catch (error) {
    next(error);
  }
});

router.get('/persons/:id/same-name-candidates', async (req, res, next) => {
  try {
    const candidates = await getSameNamePersonCandidates(req.params.id);
    res.json({ candidates });
  } catch (error) {
    next(error);
  }
});

const undoPersonActionSchema = z.object({
  actionType: z.enum(['rename', 'merge']),
  actor: z.string().optional().default('admin'),
});

router.post('/persons/actions/:actionId/undo', async (req, res, next) => {
  try {
    const data = undoPersonActionSchema.parse(req.body ?? {});
    if (data.actionType === 'rename') {
      await undoPersonRename(req.params.actionId, data.actor);
    } else {
      await undoPersonMerge(req.params.actionId, data.actor);
    }
    res.json({ message: 'Person action undone successfully' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// BIOGRAPHY ENDPOINTS
// ============================================================================

const saveBiographySchema = z.object({
  biography: z.string(),
  hook: z.string().optional(),
  verify: z.boolean().optional(),
});

/**
 * PUT /admin/entities/persons/:id/biography - Save/verify biography
 */
router.put('/persons/:id/biography', async (req, res, next) => {
  try {
    const data = saveBiographySchema.parse(req.body);
    const person = await getCanonicalPersonById(req.params.id);
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    const updateData: BiographyUpdateData = {
      biography: data.biography,
      hook: data.hook,
    };

    if (data.verify) {
      updateData.biographyStatus = 'VERIFIED';
      updateData.biographyVerifiedAt = new Date();
      updateData.biographyVerifiedBy = 'admin';
    } else {
      // If edited after verified, mark as edited
      updateData.biographyStatus = 'EDITED';
    }

    await updatePersonBiography(req.params.id, updateData);
    const updated = await getCanonicalPersonById(req.params.id);
    res.json({ person: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/entities/persons/:id/biography/unverify - Revert to editable state
 */
router.post('/persons/:id/biography/unverify', async (req, res, next) => {
  try {
    const person = await getCanonicalPersonById(req.params.id);
    if (!person) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    await updatePersonBiography(req.params.id, {
      biographyStatus: 'EDITED',
      biographyVerifiedAt: null,
      biographyVerifiedBy: null,
    });

    const updated = await getCanonicalPersonById(req.params.id);
    res.json({ person: updated });
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

    const letters = await getLettersForPlaceEnriched(req.params.id);
    res.json({ place, letters });
  } catch (error) {
    next(error);
  }
});

router.post('/places/:id/themes/generate', async (req, res, next) => {
  try {
    const result = await generatePlaceThemes(req.params.id);
    const place = await getCanonicalPlaceById(req.params.id);
    if (!place) {
      res.status(404).json({ error: 'Place not found' });
      return;
    }

    res.json({
      place,
      themes: extractPlaceThemesFromNotes(result.notes),
    });
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
    const { undoActionId } = await updateCanonicalPlaceWithUndo(req.params.id, data);
    const place = await getCanonicalPlaceById(req.params.id);
    res.json({ place, undoActionId });
  } catch (error) {
    next(error);
  }
});

const mergePlacesSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid(),
});

/**
 * POST /admin/entities/places/merge - Merge two places
 */
router.post('/places/merge', async (req, res, next) => {
  try {
    const { keepId, mergeId } = mergePlacesSchema.parse(req.body);
    const { undoActionId } = await mergePlacesWithUndo(keepId, mergeId);
    const place = await getCanonicalPlaceById(keepId);
    res.json({ place, message: 'Places merged successfully', undoActionId });
  } catch (error) {
    next(error);
  }
});

const bulkMergePlacesSchema = z.object({
  keepId: z.string().uuid(),
  mergeIds: z.array(z.string().uuid()).min(1),
});

/**
 * POST /admin/entities/places/bulk-merge - Merge multiple places into one
 */
router.post('/places/bulk-merge', async (req, res, next) => {
  try {
    const { keepId, mergeIds } = bulkMergePlacesSchema.parse(req.body);
    await bulkMergePlaces(keepId, mergeIds);
    const place = await getCanonicalPlaceById(keepId);
    res.json({ place, message: `${mergeIds.length} places merged successfully` });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/entities/places/:id/merge-details - Get detailed info for merge comparison
 */
router.get('/places/:id/merge-details', async (req, res, next) => {
  try {
    const details = await getPlaceDetailsForMerge(req.params.id);
    if (!details) {
      res.status(404).json({ error: 'Place not found' });
      return;
    }
    res.json(details);
  } catch (error) {
    next(error);
  }
});

router.get('/places/:id/same-name-candidates', async (req, res, next) => {
  try {
    const candidates = await getSameNamePlaceCandidates(req.params.id);
    res.json({ candidates });
  } catch (error) {
    next(error);
  }
});

const undoPlaceActionSchema = z.object({
  actionType: z.enum(['rename', 'merge']),
  actor: z.string().optional().default('admin'),
});

router.post('/places/actions/:actionId/undo', async (req, res, next) => {
  try {
    const data = undoPlaceActionSchema.parse(req.body ?? {});
    if (data.actionType === 'rename') {
      await undoPlaceRename(req.params.actionId, data.actor);
    } else {
      await undoPlaceMerge(req.params.actionId, data.actor);
    }
    res.json({ message: 'Place action undone successfully' });
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
    const id = await createRelationship({
      ...data,
      ...buildHumanEntityProvenancePatch('admin'),
    });
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
    await updateRelationship(req.params.id, {
      ...data,
      ...buildHumanEntityProvenancePatch('admin'),
    });
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
