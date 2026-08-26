import { createServer } from 'node:http';
import { bootstrapIfEmpty } from './bootstrap.ts';
import { openDb } from './db.ts';
import { createApp } from './routes.ts';
import { staticSite } from './static.ts';

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const port = Number(process.env.PORT ?? 3000);
const db = openDb();
bootstrapIfEmpty(db);

// Serving the client is opt-out: if a build exists, one process hosts
// everything. In development Vite serves the client instead.
const site = process.env.POLARIS_SERVE_WEB === '0'
  ? null
  : staticSite(process.env.POLARIS_WEB_DIR ?? 'apps/web/dist');

const server = createServer(createApp(db, site));

server.listen(port, () => {
  log(
    site
      ? `polaris-pas listening on http://localhost:${port} (api under /api, client served)`
      : `polaris-pas api listening on http://localhost:${port}/api`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(`\n${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
