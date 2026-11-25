import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { type PortalRole, roleOf } from './roles.js';

// AB#edit-hold-release, criterion 8: the audit log is for compliance. Entries are only ever added.
export interface AuditWrite {
  entityType: string;
  entityId: number;
  action: string;
  role: PortalRole;
  // Never put compensation amounts here.
  details: Record<string, unknown>;
}

// Adds one entry. Call it inside the transaction that saves the change it describes.
export function writeAudit(db: DatabaseSync, entry: AuditWrite): void {
  db.prepare(
    `INSERT INTO audit_log (entity_type, entity_id, action, role, details)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entry.entityType, entry.entityId, entry.action, entry.role, JSON.stringify(entry.details));
}

// Runs the work in one transaction. If the work throws, the change and its audit entry are both rolled back.
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  role: string;
  details: unknown;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toAuditEntry(row: Row): AuditEntry {
  return {
    id: Number(row.id),
    entityType: String(row.entity_type),
    entityId: Number(row.entity_id),
    action: String(row.action),
    role: String(row.role),
    details: JSON.parse(String(row.details)) as unknown,
    createdAt: String(row.created_at),
  };
}

function parseEntityId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// AB#edit-hold-release, criteria 9 and 12: read-only. hr_manager gets the entries for one new hire, newest first.
// No route here, or anywhere else, changes or removes an entry.
export function createAuditRouter(db: DatabaseSync): Router {
  const router = Router();

  router.get('/', (req, res) => {
    if (roleOf(res) !== 'hr_manager') {
      res.status(403).json({ error: 'Only HR managers can view the audit log.' });
      return;
    }

    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : '';
    const entityId = typeof req.query.entityId === 'string' ? parseEntityId(req.query.entityId) : null;
    const errors: Record<string, string> = {};
    if (entityType !== 'new_hire') {
      errors.entityType = 'Choose entityType=new_hire.';
    }
    if (entityId === null) {
      errors.entityId = 'Enter a valid entityId.';
    }
    if (entityType !== 'new_hire' || entityId === null) {
      res.status(400).json({ errors });
      return;
    }

    const rows = db
      .prepare(
        `SELECT id, entity_type, entity_id, action, role, details, created_at
         FROM audit_log
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY id DESC`,
      )
      .all(entityType, entityId);
    res.json(rows.map(toAuditEntry));
  });

  return router;
}
