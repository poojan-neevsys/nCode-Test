import express, { type ErrorRequestHandler, type Express } from 'express';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createAuditRouter } from './audit.js';
import { checkDatabase } from './db.js';
import { createNewHiresRouter } from './new-hires.js';
import { createRequisitionsRouter } from './requisitions.js';
import { attachRole } from './roles.js';
import { createTemplatesRouter } from './templates.js';

export function createApp(db: DatabaseSync, clientDistDir: string): Express {
  const app = express();
  app.disable('x-powered-by');

  // AB#comp-roles, criterion 2: every request gets an acting role from X-Portal-Role.
  app.use(attachRole);

  // AB#foundation, criterion 2: 200 when the database answers, 503 when it does not.
  app.get('/api/health', (_req, res) => {
    const databaseOk = checkDatabase(db);
    res.status(databaseOk ? 200 : 503).json({
      status: databaseOk ? 'ok' : 'error',
      database: databaseOk ? 'ok' : 'error',
    });
  });

  // AB#new-hire-draft: new hire list and draft creation.
  app.use('/api/new-hires', createNewHiresRouter(db));

  // AB#requisition-link, criterion 2: open requisition search for the create form.
  app.use('/api/requisitions', createRequisitionsRouter(db));

  // AB#letter-templates, criteria 2 to 7: welcome letter templates and their preview.
  app.use('/api/templates', createTemplatesRouter(db));

  // AB#audit-log, criteria 6 and 7: read-only audit entries for hr_manager.
  app.use('/api/audit', createAuditRouter(db));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // AB#foundation, criterion 4: the built client is served on the same port.
  app.use(express.static(clientDistDir));

  // Single-page fallback for any other GET or HEAD request.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.sendFile(join(clientDistDir, 'index.html'), (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
  app.use(onError);

  return app;
}
