import { Router } from 'express';
import {
  unverifyExtraContent,
  unverifyMetadata,
  unverifyTranscript,
  verifyExtraContent,
  verifyMetadata,
  verifyTranscript,
} from '../../../services/letter-operations.js';
import { NotFoundError } from '../../../utils/response-helpers.js';
import { getUserId, requireLetterDto } from './helpers.js';

const router = Router();

router.post('/:letterId/verify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyTranscript(letterId, getUserId(req));
    if (!result) throw new NotFoundError('Letter not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/unverify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyTranscript(letterId);
    if (!result) throw new NotFoundError('Letter not found or not verified');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/verify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyMetadata(letterId, getUserId(req));
    if (!result) throw new NotFoundError('Letter not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/unverify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyMetadata(letterId);
    if (!result) throw new NotFoundError('Letter not found or not verified');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/verify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyExtraContent(letterId, getUserId(req));
    if (!result) throw new NotFoundError('Letter not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/unverify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyExtraContent(letterId);
    if (!result) throw new NotFoundError('Letter not found or not verified');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

export default router;
