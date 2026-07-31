import { Router } from 'express';
import { z } from 'zod';
import {
  getProductionTranscriptAlignment,
} from '../../services/transcript-alignment/production-letter.js';
import { NotFoundError } from '../../utils/response-helpers.js';

const letterParamsSchema = z.object({
  letterId: z.string().uuid(),
}).strict();

interface ProductionTranscriptAlignmentRouterDependencies {
  loadAlignment: typeof getProductionTranscriptAlignment;
}

export function createProductionTranscriptAlignmentRouter(
  dependencies: ProductionTranscriptAlignmentRouterDependencies = {
    loadAlignment: getProductionTranscriptAlignment,
  },
) {
  const router = Router();

  router.get('/:letterId/transcript-alignment', async (req, res, next) => {
    try {
      const { letterId } = letterParamsSchema.parse(req.params);
      const alignment = await dependencies.loadAlignment(letterId);
      if (!alignment) throw new NotFoundError('Letter not found');
      res.json(alignment);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createProductionTranscriptAlignmentRouter();
