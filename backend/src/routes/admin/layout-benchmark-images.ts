import { readFile } from 'node:fs/promises';
import { Router, type RequestHandler } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { verifyImageSessionToken } from '../../auth/jwt.js';
import { readImageSessionCookie } from '../../auth/image-session.js';
import {
  defaultLayoutBenchmarkStore,
  LayoutBenchmarkStore,
} from '../../benchmarks/layout/store.js';
import { adminUsers, db } from '../../db/index.js';
import { layoutBenchmarkFeatureEnabled } from './layout-benchmark.js';

const imageArtifactKindSchema = z.enum([
  'prepared',
  'overlay',
  'pageMask',
  'engineInput',
]);

async function requireBenchmarkImageSession(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
): Promise<void> {
  const token = readImageSessionCookie(req.headers.cookie);
  const session = token ? verifyImageSessionToken(token) : null;
  if (!session) {
    res.status(401).json({ error: 'Image session required' });
    return;
  }
  try {
    const existingAdmin = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, session.userId),
      columns: { id: true },
    });
    if (!existingAdmin) {
      res.status(401).json({ error: 'Image session is no longer valid' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export interface LayoutBenchmarkImageRouterOptions {
  store?: LayoutBenchmarkStore;
  enabled?: () => boolean;
  authorize?: RequestHandler;
}

export function createLayoutBenchmarkImageRouter(
  options: LayoutBenchmarkImageRouterOptions = {},
) {
  const router = Router();
  const store = options.store ?? defaultLayoutBenchmarkStore;
  const enabled = options.enabled ?? layoutBenchmarkFeatureEnabled;

  router.use((_req, res, next) => {
    if (!enabled()) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  });
  router.use(options.authorize ?? requireBenchmarkImageSession);

  router.get('/pages/:pageKey/source', async (req, res, next) => {
    try {
      const source = await store.resolveSource(req.params.pageKey);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', source.contentType);
      res.setHeader('Content-Length', String(source.sizeBytes));
      res.send(await readFile(source.absolutePath));
    } catch (error) {
      next(error);
    }
  });

  router.get('/runs/:runId/pages/:pageKey/:kind', async (req, res, next) => {
    try {
      const kind = imageArtifactKindSchema.parse(req.params.kind);
      const artifact = await store.resolveRunArtifact(
        req.params.runId,
        req.params.pageKey,
        kind,
      );
      if (!artifact.contentType.startsWith('image/')) {
        res.status(415).json({ error: 'Artifact is not an image' });
        return;
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Content-Length', String(artifact.sizeBytes));
      res.send(await readFile(artifact.absolutePath));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export default createLayoutBenchmarkImageRouter();
