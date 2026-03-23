import { Router } from 'express';
import {
  addLinkedPerson,
  addLinkedPlace,
  removeLinkedPerson,
  removeLinkedPlace,
  updateLinkedPerson,
  updateLinkedPlace,
} from '../../../services/letter-operations.js';
import {
  addLinkedPersonSchema,
  addLinkedPlaceSchema,
  updateLinkedPersonSchema,
  updateLinkedPlaceSchema,
} from './shared.js';
import { NotFoundError } from '../../../utils/response-helpers.js';
import { parseOrThrow, requireLetterDto } from './helpers.js';

const router = Router();

router.put('/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const { canonicalName } = parseOrThrow(updateLinkedPersonSchema, req.body, 'Invalid request body');
    const result = await updateLinkedPerson(letterId, linkId, canonicalName);
    if (!result) throw new NotFoundError('Link not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.put('/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const { canonicalName } = parseOrThrow(updateLinkedPlaceSchema, req.body, 'Invalid request body');
    const result = await updateLinkedPlace(letterId, linkId, canonicalName);
    if (!result) throw new NotFoundError('Link not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/linked-persons', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { name, role } = parseOrThrow(addLinkedPersonSchema, req.body, 'Invalid request body');
    const result = await addLinkedPerson(letterId, name, role);
    if (!result) throw new NotFoundError('Letter or person not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/linked-places', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { name: placeName, role: placeRole } = parseOrThrow(addLinkedPlaceSchema, req.body, 'Invalid request body');
    const result = await addLinkedPlace(letterId, placeName, placeRole);
    if (!result) throw new NotFoundError('Letter or place not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.delete('/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const result = await removeLinkedPerson(letterId, linkId);
    if (!result) throw new NotFoundError('Link not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.delete('/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const result = await removeLinkedPlace(letterId, linkId);
    if (!result) throw new NotFoundError('Link not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

export default router;
