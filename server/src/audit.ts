import { type Response, Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { type PortalRole, roleOf } from './roles.js';

// AB#audit-log, criterion 1: the entity types the audit log records.
export const AUDIT_ENTITY_TYPES = ['new_hire'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export interface AuditWrite {
  entityType: AuditEntityType;
  entityId: number;
  action: string;
  role: PortalRole;
  details: string;
}

// AB#audit-log, criteria 3 and 8: entries are only inserted. Callers run this inside the
// transaction of the change they record. The database triggers reject any update or delete.
export function writeAudit(db: DatabaseSync, entry: AuditWrite): void {
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

function toAuditEntry(row: Row): AuditEntry {
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

// Only a positive whole number is an entity id; anything else is rejected.
function parseEntityId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

// AB#audit-log, criterion 9: only hr_manager may read the audit log.
function denyUnlessHrManager(res: Response): boolean {
  if (roleOf(res) !== 'hr_manager') {
    res.status(403).json({ error: 'Only HR managers can view the audit log.' });
    return true;
  }
  return false;
}

export function createAuditRouter(db: DatabaseSync): Router {
  const router = Router();

  // AB#audit-log, criterion 9: entries for one entity, newest first. There is no route that changes or removes them.
  router.get('/', (req, res) => {
    if (denyUnlessHrManager(res)) {
      return;
    }
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : '';
    const rawEntityId = typeof req.query.entityId === 'string' ? req.query.entityId : '';
    const entityId = parseEntityId(rawEntityId);

    const errors: Record<string, string> = {};
    if (!(AUDIT_ENTITY_TYPES as readonly string[]).includes(entityType)) {
      errors.entityType = `Choose one of: ${AUDIT_ENTITY_TYPES.join(', ')}.`;
    }
    if (entityId === null) {
      errors.entityId = 'Enter a positive whole number.';
    }
    if (Object.keys(errors).length > 0 || entityId === null) {
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
