import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * Serves the built web client so one process can host the whole app.
 *
 * The API lives under /api; everything else is either a real file from the
 * build output or, for a client-side route like /accounts/123, the SPA shell.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticSite {
  /** Serve `pathname`, returning false when the caller should 404 instead. */
  serve: (pathname: string, res: ServerResponse) => boolean;
}

/**
 * Returns null when `dir` has no build in it, so the server can run
 * API-only in development without complaining.
 */
export function staticSite(dir: string): StaticSite | null {
  const root = resolve(dir);
  const shell = join(root, 'index.html');
  if (!existsSync(shell)) return null;

  function send(file: string, res: ServerResponse, status = 200): void {
    const ext = extname(file).toLowerCase();
    // Vite fingerprints asset filenames, so they can be cached indefinitely.
    // The shell must not be, or a deploy would never reach the browser.
    const cache = file.startsWith(join(root, 'assets') + sep)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(status, {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'content-length': statSync(file).size,
      'cache-control': cache,
    });
    createReadStream(file).pipe(res);
  }

  return {
    serve(pathname, res) {
      // Resolve inside the root and verify it stayed there: a request for
      // /../../etc/passwd must never escape the build directory.
      const requested = resolve(root, `.${normalize(pathname)}`);
      const inside = requested === root || requested.startsWith(root + sep);

      if (inside && requested !== root && existsSync(requested)) {
        const stats = statSync(requested);
        if (stats.isFile()) {
          send(requested, res);
          return true;
        }
      }

      // A missing asset is a 404, not the shell: returning HTML for a missing
      // .js file produces a confusing MIME error in the browser instead.
      if (extname(pathname) !== '') return false;

      send(shell, res);
      return true;
    },
  };
}
