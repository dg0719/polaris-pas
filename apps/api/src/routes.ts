import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db.ts';
import { HttpResult, Router, errorResponse, readJsonBody, sendJson } from './http.ts';
import { registerAccountRoutes } from './routes/accounts.ts';
import { registerClaimRoutes } from './routes/claims.ts';
import { registerJobRoutes } from './routes/jobs.ts';
import { registerDemoRoutes, registerMetaRoutes } from './routes/meta.ts';
import { registerPolicyRoutes } from './routes/policies.ts';
import { registerUserRoutes } from './routes/users.ts';
import type { StaticSite } from './static.ts';

export function buildRouter(db: Db): Router {
  const router = new Router();
  registerMetaRoutes(router, db);
  registerDemoRoutes(router, db);
  registerAccountRoutes(router, db);
  registerJobRoutes(router, db);
  registerPolicyRoutes(router, db);
  registerClaimRoutes(router, db);
  registerUserRoutes(router, db);
  return router;
}

/** Browsers preflight the dev server's cross-origin calls; answer them cheaply. */
function applyCors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
}

const API_PREFIX = '/api';

/**
 * The client and the API share an origin, so the API answers under /api and
 * the client owns every other path. Without the prefix they would collide:
 * /accounts is both an API resource and a screen in the app.
 */
function apiPath(pathname: string): string | null {
  if (pathname === API_PREFIX) return '/';
  if (pathname.startsWith(`${API_PREFIX}/`)) return pathname.slice(API_PREFIX.length);
  return null;
}

/**
 * Build the node:http request listener. Pass `site` to also serve the built
 * web client from the same process; omit it to run API-only.
 */
export function createApp(
  db: Db,
  site: StaticSite | null = null,
): (req: IncomingMessage, res: ServerResponse) => void {
  const router = buildRouter(db);

  return (req, res) => {
    void (async () => {
      try {
        applyCors(res);
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url ?? '/', 'http://localhost');
        const routed = apiPath(url.pathname);

        if (routed === null) {
          // Not an API call: hand it to the client build, if one is served.
          if (site && (req.method === 'GET' || req.method === 'HEAD')) {
            if (site.serve(url.pathname, res)) return;
          }
          sendJson(res, 404, { error: { code: 'not_found', message: 'No such route' } });
          return;
        }

        const match = router.match(req.method ?? 'GET', routed);
        if (!match) {
          sendJson(res, 404, { error: { code: 'not_found', message: 'No such route' } });
          return;
        }
        const payload = await match.handler({
          req,
          res,
          params: match.params,
          query: url.searchParams,
          body: await readJsonBody(req),
        });
        if (res.writableEnded) return;
        if (payload instanceof HttpResult) sendJson(res, payload.status, payload.payload);
        else sendJson(res, 200, payload ?? {});
      } catch (err) {
        const { status, payload } = errorResponse(err);
        if (!res.writableEnded) sendJson(res, status, payload);
      }
    })();
  };
}
