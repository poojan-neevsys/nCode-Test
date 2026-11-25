import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { DatabaseSync } from 'node:sqlite';

export function createApp(db: DatabaseSync, clientDir: string): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // AB#story, criterion 2: 200 when the database answers, 503 when the check fails.
  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.status(200).json({ status: 'ok', database: 'ok' });
    } catch {
      res.status(503).json({ status: 'error', database: 'error' });
    }
  });

  // AB#story, criterion 4: serve the built client from the same port.
  const indexFile = path.join(clientDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(express.static(clientDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(indexFile);
    });
  }

  return app;
}
