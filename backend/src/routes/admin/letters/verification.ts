import { Router } from 'express';
import {
  unverifyExtraContent,
  unverifyMetadata,
  unverifyPhotoDescription,
  unverifyTranscript,
  verifyExtraContent,
  verifyMetadata,
  verifyPhotoDescription,
  verifyTranscript,
} from '../../../services/letter-operations.js';
import { NotFoundError } from '../../../utils/response-helpers.js';
import {
  getUserId,
  requireLetterDto,
  requirePrimarySourceRevision,
} from './helpers.js';

const router = Router();

router.post('/:letterId/verify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before verifying its transcript',
    );
    const result = await verifyTranscript(
      letterId,
      primarySourceRevision,
      getUserId(req),
    );
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before removing transcript verification',
    );
    const result = await unverifyTranscript(letterId, primarySourceRevision);
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before verifying its metadata',
    );
    const result = await verifyMetadata(
      letterId,
      primarySourceRevision,
      getUserId(req),
    );
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before removing metadata verification',
    );
    const result = await unverifyMetadata(letterId, primarySourceRevision);
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before verifying extra content',
    );
    const result = await verifyExtraContent(
      letterId,
      primarySourceRevision,
      getUserId(req),
    );
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
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Letter source version is missing; reload before removing extra-content verification',
    );
    const result = await unverifyExtraContent(letterId, primarySourceRevision);
    if (!result) throw new NotFoundError('Letter not found or not verified');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/verify-photo-description', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Photo source version is missing; reload before verifying its description',
    );
    const result = await verifyPhotoDescription(
      letterId,
      primarySourceRevision,
      getUserId(req),
    );
    if (!result) throw new NotFoundError('Letter not found');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/:letterId/unverify-photo-description', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const primarySourceRevision = requirePrimarySourceRevision(
      req.body,
      'Photo source version is missing; reload before removing description verification',
    );
    const result = await unverifyPhotoDescription(letterId, primarySourceRevision);
    if (!result) throw new NotFoundError('Letter not found or not verified');
    const letterDTO = await requireLetterDto(letterId);
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

export default router;
