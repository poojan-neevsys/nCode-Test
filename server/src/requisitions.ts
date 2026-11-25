import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';

// AB#requisition-link, criterion 2: at most this many matches are returned.
const SEARCH_LIMIT = 20;

export interface RequisitionSummary {
  id: number;
  number: string;
  jobTitle: string;
  department: string;
  hiringManagerName: string;
}

type Row = Record<string, unknown>;

function toSummary(row: Row): RequisitionSummary {
  return {
    id: Number(row.id),
    number: String(row.number),
    jobTitle: String(row.job_title),
    department: String(row.department),
    hiringManagerName: String(row.hiring_manager_name),
  };
}

// Wraps the text in % wildcards and escapes LIKE wildcards in it, so the text
// is matched literally. '!' is the escape character.
function containsPattern(text: string): string {
  return `%${text.replace(/[!%_]/g, (char) => `!${char}`)}%`;
}

// AB#requisition-link, criteria 3 and 4: the requisition may be linked only when it exists,
// is open and is not linked to a new hire yet.
// exceptNewHireId: when editing a new hire that already holds this requisition, that link does not count as taken.
export function findLinkableRequisition(
  db: DatabaseSync,
  id: number,
  exceptNewHireId?: number,
): { requisition: RequisitionSummary } | { error: string } {
  const row = db
    .prepare(
      `SELECT id, number, job_title, department, hiring_manager_name, status
       FROM requisitions
       WHERE id = ?`,
    )
    .get(id);
  if (!row) {
    return { error: 'The requisition does not exist.' };
  }
  if (String(row.status) !== 'open') {
    return { error: 'The requisition is not open.' };
  }
  const linked = db
    .prepare('SELECT id FROM new_hires WHERE requisition_id = ? AND id <> ?')
    .get(id, exceptNewHireId ?? 0);
  if (linked) {
    return { error: 'The requisition is already linked to another new hire.' };
  }
  return { requisition: toSummary(row) };
}

export function createRequisitionsRouter(db: DatabaseSync): Router {
  const router = Router();

  // AB#requisition-link, criterion 2: open requisitions whose number or job title contains the text.
  router.get('/', (req, res) => {
    const text = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const pattern = containsPattern(text);
    const rows = db
      .prepare(
        `SELECT id, number, job_title, department, hiring_manager_name
         FROM requisitions
         WHERE status = 'open'
           AND (number LIKE ? ESCAPE '!' OR job_title LIKE ? ESCAPE '!')
         ORDER BY number
         LIMIT ?`,
      )
      .all(pattern, pattern, SEARCH_LIMIT);
    res.json(rows.map(toSummary));
  });

  return router;
}
