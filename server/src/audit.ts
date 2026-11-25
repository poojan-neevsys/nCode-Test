import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { type PortalRole, roleOf } from './roles.js';

// AB#audit-log, criteria 2 and 5: entries are written with the change they record, in the same transaction.
// Callers must not put compensation amounts in details.
export interface AuditInput {
  entityType: string;
  entityId: number;
  action: string;
  role: PortalRole;
  details: string;
}

// Only inserts happen here. The database triggers reject any update or delete of an entry.
export function writeAudit(db: DatabaseSync, entry: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_log (entity_type, entity_id, action, role, details)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(entry.entityType, entry.entityId, entry.action, entry.role, entry.details);
}

export interface AuditEntry {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  role: string;
  details: string;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toEntry(row: Row): AuditEntry {
  return {
    id: Number(row.id),
    entityType: String(row.entity_type),
    entityId: Number(row.entity_id),
    action: String(row.action),
    role: String(row.role),
    details: String(row.details),
    createdAt: String(row.created_at),
  };
}

// Whole positive numbers only, and only numbers that survive as safe integers.
function parsePositiveId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function createAuditRouter(db: DatabaseSync): Router {
  const router = Router();

  // AB#audit-log, criterion 6: hr_manager reads the entries for one new hire, newest first.
  // Only GET exists here, so no endpoint can update or delete an entry.
  router.get('/', (req, res) => {
    if (roleOf(res) !== 'hr_manager') {
      res.status(403).json({ error: 'Only HR managers can view the audit log.' });
      return;
    }

    const entityType = req.query.entityType;
    const entityId = parsePositiveId(req.query.entityId);
    const errors: Record<string, string> = {};
    if (entityType !== 'new_hire') {
      errors.entityType = 'Choose one of: new_hire.';
    }
    if (entityId === null) {
      errors.entityId = 'Enter a whole number.';
    }
    if (entityId === null || Object.keys(errors).length > 0) {
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
      .all('new_hire', entityId);
    res.json(rows.map(toEntry));
  });

  return router;
}
