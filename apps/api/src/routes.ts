import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Db } from './db.ts';
import { HttpResult, Router, errorResponse, readJsonBody, sendJson } from './http.ts';
import { registerAccountRoutes } from './routes/accounts.ts';
import { registerJobRoutes } from './routes/jobs.ts';
import { registerDemoRoutes, registerMetaRoutes } from './routes/meta.ts';
import { registerPolicyRoutes } from './routes/policies.ts';

export function buildRouter(db: Db): Router {
  const router = new Router();
  registerMetaRoutes(router, db);
  registerDemoRoutes(router, db);
  registerAccountRoutes(router, db);
  registerJobRoutes(router, db);
  registerPolicyRoutes(router, db);
  return router;
}

/** Browsers preflight the dev server's cross-origin calls; answer them cheaply. */
function applyCors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
}

/** Build the node:http request listener for a given database handle. */
export function createApp(db: Db): (req: IncomingMessage, res: ServerResponse) => void {
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
        const match = router.match(req.method ?? 'GET', url.pathname);
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
