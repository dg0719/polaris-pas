import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.ts';

const MAX_BODY_BYTES = 1_000_000;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}

export type Handler = (ctx: RequestContext) => unknown | Promise<unknown>;

/** Wrap a handler result to override the default status code. */
export class HttpResult {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    this.status = status;
    this.payload = payload;
  }
}

export function created(payload: unknown): HttpResult {
  return new HttpResult(201, payload);
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw ApiError.badRequest('Request body too large', 'body_too_large');
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw ApiError.badRequest('Request body must be valid JSON', 'invalid_json');
  }
}

/** Tiny path router: `/jobs/:id/quote` style patterns, no dependencies. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter(Boolean),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): this {
    return this.add('PUT', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i]!;
        const part = parts[i]!;
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(part);
        else if (seg !== part) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method.toUpperCase()) return { handler: route.handler, params };
    }
    if (pathMatched) throw new ApiError(405, 'method_not_allowed', `${method} not allowed here`);
    return null;
  }
}

export function errorResponse(err: unknown): { status: number; payload: unknown } {
  if (err instanceof ApiError) {
    return { status: err.status, payload: { error: { code: err.code, message: err.message } } };
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  return { status: 500, payload: { error: { code: 'internal_error', message } } };
}
