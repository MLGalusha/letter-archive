import { EventEmitter } from 'node:events';
import type { NextFunction, RequestHandler, Response } from 'express';
import { errorHandler } from '../middleware/error-handler.js';
import { requestLogger } from '../middleware/request-logger.js';

interface InvokeOptions {
  method: string;
  url: string;
  path?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface MockResponse extends EventEmitter {
  statusCode: number;
  headersSent: boolean;
  body?: unknown;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
  get(name: string): string | undefined;
  status(code: number): MockResponse;
  json(body: unknown): MockResponse;
  send(body: unknown): MockResponse;
  end(body?: unknown): MockResponse;
}

export interface InvokeResult {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function createMockResponse(): { res: MockResponse; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = new EventEmitter() as MockResponse;

  res.statusCode = 200;
  res.headersSent = false;
  res.setHeader = (name: string, value: string) => {
    headers[name.toLowerCase()] = String(value);
  };
  res.getHeader = (name: string) => headers[name.toLowerCase()];
  res.get = (name: string) => headers[name.toLowerCase()];
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    res.headersSent = true;
    res.emit('finish');
    return res;
  };
  res.send = (body: unknown) => {
    res.body = body;
    res.headersSent = true;
    res.emit('finish');
    return res;
  };
  res.end = (body?: unknown) => {
    if (body !== undefined) {
      res.body = body;
    }
    res.headersSent = true;
    res.emit('finish');
    return res;
  };

  return { res, headers };
}

export async function invokeRouter(
  router: { handle(req: unknown, res: unknown, next: NextFunction): void } | RequestHandler,
  options: InvokeOptions,
): Promise<InvokeResult> {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );

  const req = new EventEmitter() as Parameters<RequestHandler>[0];
  (req as { method: string }).method = options.method;
  (req as { url: string }).url = options.url;
  (req as { originalUrl: string }).originalUrl = options.url;
  (req as { path: string }).path = options.path ?? options.url;
  (req as { query: Record<string, unknown> }).query = options.query ?? {};
  (req as { body: unknown }).body = options.body;
  (req as { headers: Record<string, string> }).headers = headers;
  (req as { get: (name: string) => string | undefined }).get = (name: string) => headers[name.toLowerCase()];
  (req as { ip: string }).ip = '127.0.0.1';

  const { res, headers: responseHeaders } = createMockResponse();

  return await new Promise<InvokeResult>((resolve, reject) => {
    let settled = false;

    const finalize = () => {
      if (settled) return;
      settled = true;
      resolve({
        statusCode: res.statusCode,
        body: res.body,
        headers: responseHeaders,
      });
    };

    res.once('finish', finalize);

    requestLogger(req as Parameters<RequestHandler>[0], res as unknown as Response, () => {
      (router as { handle(req: unknown, res: unknown, next: NextFunction): void }).handle(
        req,
        res as unknown as Response,
        ((error?: unknown) => {
          if (error) {
            errorHandler(
              error as never,
              req as never,
              res as never,
              (() => undefined) as NextFunction,
            );
            return;
          }

          if (!res.headersSent) {
            finalize();
          }
        }) as NextFunction,
      );
    });

    setImmediate(() => {
      if (!settled && !res.headersSent) {
        reject(new Error(`Request did not complete for ${options.method} ${options.url}`));
      }
    });
  });
}
