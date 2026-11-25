import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { isDatabaseHealthy } from './db.js';

export function createApp(db: DatabaseSync, clientDistPath: string): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // AB#story, criterion 2: 200 when the database answers, 503 with database "error" otherwise.
  app.get('/api/health', (_req, res) => {
    const databaseOk = isDatabaseHealthy(db);
    res.status(databaseOk ? 200 : 503).json({
      status: databaseOk ? 'ok' : 'error',
      database: databaseOk ? 'ok' : 'error',
    });
  });

  // AB#story, criterion 4: the built client is served from the same port.
  app.use(express.static(clientDistPath));

  // Client-side fallback for non-API GET requests; unknown API paths return 404.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(join(clientDistPath, 'index.html'), (error) => {
      if (error) {
        next(error);
      }
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Request failed:', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
