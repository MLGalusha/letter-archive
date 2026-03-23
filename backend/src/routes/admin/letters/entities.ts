import { Router } from 'express';
import {
  addLinkedPerson,
  addLinkedPlace,
  removeLinkedPerson,
  removeLinkedPlace,
  updateLinkedPerson,
  updateLinkedPlace,
} from '../../../services/letter-operations.js';
import { fetchLetterWithRelatedAndTransform } from '../../../services/letter-queries.js';
import {
  addLinkedPersonSchema,
  addLinkedPlaceSchema,
  updateLinkedPersonSchema,
  updateLinkedPlaceSchema,
} from './shared.js';

const router = Router();

router.put('/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const parseResult = updateLinkedPersonSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await updateLinkedPerson(letterId, linkId, parseResult.data.canonicalName);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const parseResult = updateLinkedPlaceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await updateLinkedPlace(letterId, linkId, parseResult.data.canonicalName);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/linked-persons', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = addLinkedPersonSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { name, role } = parseResult.data;
    const result = await addLinkedPerson(letterId, name, role);
    if (!result) {
      res.status(404).json({ error: 'Letter or person not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/linked-places', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = addLinkedPlaceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { name: placeName, role: placeRole } = parseResult.data;
    const result = await addLinkedPlace(letterId, placeName, placeRole);
    if (!result) {
      res.status(404).json({ error: 'Letter or place not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.delete('/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const result = await removeLinkedPerson(letterId, linkId);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.delete('/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const result = await removeLinkedPlace(letterId, linkId);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

export default router;
