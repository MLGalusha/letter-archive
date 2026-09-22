import type { RequestHandler, Router } from 'express';

/** Load an optional route graph once, sharing the first load across requests. */
export function lazyRouter(load: () => Promise<{ default: Router }>): RequestHandler {
  let router: Router | undefined;
  let pending: Promise<Router> | undefined;
  return (req, res, next) => {
    if (router) return router(req, res, next);
    pending ??= Promise.resolve().then(load).then((module) => {
      router = module.default;
      return router;
    }).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    void pending.then((loaded) => {
      if (!res.destroyed && !res.writableEnded) loaded(req, res, next);
    }).catch(next);
  };
}
