// Minimal static file server for the ZK glasses app (built dist/).
// Serves on a separate HTTP port alongside the WebSocket server.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { log } from './log.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
};

export function startStaticServer(distDir: string, port: number, host: string): void {
  if (!existsSync(distDir)) {
    log.warn(`glasses dist not found at ${distDir} — skipping static server`);
    log.warn('run: npm run build  (in second-brain/.system/glasses/)');
    return;
  }

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    let fp = join(distDir, pathname);

    if (!existsSync(fp) || statSync(fp).isDirectory()) {
      fp = join(distDir, 'index.html');
    }

    try {
      const data = readFileSync(fp);
      const mime = MIME[extname(fp)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(port, host, () => {
    log.info(`glasses app  →  http://<IP>:${port}/`);
  });
}
