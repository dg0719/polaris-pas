import { createServer } from 'node:http';
import { openDb } from './db.ts';
import { createApp } from './routes.ts';

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

const port = Number(process.env.PORT ?? 3000);
const db = openDb();
const server = createServer(createApp(db));

server.listen(port, () => {
  log(`polaris-pas api listening on http://localhost:${port}`);
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
