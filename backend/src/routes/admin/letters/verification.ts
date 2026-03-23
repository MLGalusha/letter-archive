import { Router } from 'express';
import {
  unverifyExtraContent,
  unverifyMetadata,
  unverifyTranscript,
  verifyExtraContent,
  verifyMetadata,
  verifyTranscript,
} from '../../../services/letter-operations.js';
import { fetchLetterWithRelatedAndTransform } from '../../../services/letter-queries.js';

const router = Router();

router.post('/:letterId/verify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyTranscript(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
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

router.post('/:letterId/unverify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyTranscript(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found or not verified' });
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

router.post('/:letterId/verify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyMetadata(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
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

router.post('/:letterId/unverify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyMetadata(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found or not verified' });
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

router.post('/:letterId/verify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyExtraContent(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
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

router.post('/:letterId/unverify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyExtraContent(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found or not verified' });
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
