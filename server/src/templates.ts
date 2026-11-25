import express, { Router, type RequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { readCompensation } from './compensation.js';
import { idParam, onBodyError } from './new-hires.js';
import { roleOf } from './roles.js';

// AB#letter-templates, criterion 5: the only placeholders a template may use.
export const PLACEHOLDERS = [
  'firstName',
  'lastName',
  'jobTitle',
  'department',
  'startDate',
  'requisitionNumber',
  'baseSalary',
  'currency',
] as const;

// AB#letter-templates, criteria 5 and 7: placeholders whose values are compensation.
const COMPENSATION_PLACEHOLDERS: readonly string[] = ['baseSalary', 'currency'];

// AB#letter-templates, criterion 4: length limits.
const NAME_MAX = 100;
const BODY_MAX = 20000;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type TemplateField = 'name' | 'body';
export type TemplateErrors = Partial<Record<TemplateField | 'newHireId', string>>;

export interface TemplateInput {
  name: string;
  body: string;
}

export interface TemplateRecord extends TemplateInput {
  id: number;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function toRecord(row: Row): TemplateRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    body: String(row.body),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Every {{...}} token in the text, in order of appearance, without the braces and without repeats.
function placeholdersIn(body: string): string[] {
  const tokens = body.match(/\{\{[^{}]*\}\}/g) ?? [];
  const names: string[] = [];
  for (const token of tokens) {
    const name = token.slice(2, -2);
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// AB#letter-templates, criteria 3 and 4: report every invalid field and save nothing when any is invalid.
// The body error names each unknown placeholder.
export function validateTemplate(
  db: DatabaseSync,
  raw: unknown,
  ownId: number | null,
): { input: TemplateInput } | { errors: TemplateErrors } {
  const source: Record<string, unknown> =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const body = typeof source.body === 'string' ? source.body : '';
  const errors: TemplateErrors = {};

  if (name === '') {
    errors.name = 'This field is required.';
  } else if (name.length > NAME_MAX) {
    errors.name = `Enter at most ${NAME_MAX} characters.`;
  } else if (db.prepare('SELECT id FROM letter_templates WHERE name = ? AND id IS NOT ?').get(name, ownId)) {
    errors.name = 'A template with this name already exists.';
  }

  if (body.trim() === '') {
    errors.body = 'This field is required.';
  } else {
    const problems: string[] = [];
    if (body.length > BODY_MAX) {
      problems.push(`Enter at most ${BODY_MAX} characters.`);
    }
    const unknown = placeholdersIn(body).filter(
      (placeholder) => !(PLACEHOLDERS as readonly string[]).includes(placeholder),
    );
    if (unknown.length > 0) {
      const list = unknown.map((placeholder) => `{{${placeholder}}}`).join(', ');
      problems.push(
        `Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${list}. Allowed: ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}.`,
      );
    }
    if (problems.length > 0) {
      errors.body = problems.join(' ');
    }
  }

  return Object.keys(errors).length > 0 ? { errors } : { input: { name, body } };
}

// Dates are stored as YYYY-MM-DD and shown like "Monday, 4 January 2027".
// Built by hand so the text does not depend on the server's locale data.
export function formatStartDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAY_NAMES[date.getUTCDay()]}, ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

// Whole number with thousands separators, for example 1250000 -> "1,250,000".
export function formatThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// AB#letter-templates, criteria 6 and 7: replaces each placeholder with its value in one pass, so values
// are never read as placeholders. Placeholders without a value become empty text and are listed in `missing`.
export function renderTemplate(
  body: string,
  values: Map<string, string>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/\{\{([^{}]*)\}\}/g, (_token, name: string) => {
    const value = values.get(name);
    if (value === undefined) {
      if (!missing.includes(name)) {
        missing.push(name);
      }
      return '';
    }
    return value;
  });
  return { text, missing };
}

// AB#letter-templates, criterion 3: create and update are for hr_manager only; others get 403 before the body is read.
const requireTemplateEditor: RequestHandler = (_req, res, next) => {
  if (roleOf(res) !== 'hr_manager') {
    res.status(403).json({ error: 'Only HR managers can change letter templates.' });
    return;
  }
  next();
};

export function createTemplatesRouter(db: DatabaseSync): Router {
  const router = Router();

  // AB#letter-templates, criterion 2: every role sees all templates, sorted by name.
  router.get('/', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, name, body, created_at, updated_at
         FROM letter_templates
         ORDER BY name`,
      )
      .all();
    res.json(rows.map(toRecord));
  });

  // AB#letter-templates, criteria 3 and 4: create, or return 400 and save nothing.
  router.post('/', requireTemplateEditor, express.json(), (req, res) => {
    const result = validateTemplate(db, req.body, null);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    const inserted = db
      .prepare('INSERT INTO letter_templates (name, body) VALUES (?, ?)')
      .run(result.input.name, result.input.body);
    const row = db
      .prepare('SELECT id, name, body, created_at, updated_at FROM letter_templates WHERE id = ?')
      .get(Number(inserted.lastInsertRowid));
    if (!row) {
      throw new Error('Saved letter template could not be read back.');
    }
    res.status(201).json(toRecord(row));
  });

  // AB#letter-templates, criteria 3 and 4: update, or return 400 and save nothing. Unknown id gives 404.
  router.put('/:id', requireTemplateEditor, express.json(), (req, res) => {
    const id = idParam(req.params.id);
    if (id === null || !db.prepare('SELECT id FROM letter_templates WHERE id = ?').get(id)) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }

    const result = validateTemplate(db, req.body, id);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    db.prepare(
      `UPDATE letter_templates
       SET name = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(result.input.name, result.input.body, id);
    const row = db
      .prepare('SELECT id, name, body, created_at, updated_at FROM letter_templates WHERE id = ?')
      .get(id);
    if (!row) {
      throw new Error('Saved letter template could not be read back.');
    }
    res.status(200).json(toRecord(row));
  });

  // AB#letter-templates, criteria 6 and 7: preview a template for one new hire.
  // Compensation placeholders need hr_manager; for other roles the template gets 403 and no value is read.
  router.post('/:id/preview', express.json(), (req, res) => {
    const id = idParam(req.params.id);
    const template =
      id === null
        ? undefined
        : db.prepare('SELECT id, body FROM letter_templates WHERE id = ?').get(id);
    if (!template) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }

    const source: Record<string, unknown> =
      typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const newHireId = source.newHireId;
    if (typeof newHireId !== 'number' || !Number.isSafeInteger(newHireId) || newHireId <= 0) {
      res.status(400).json({ errors: { newHireId: 'Choose a new hire.' } });
      return;
    }

    const body = String(template.body);
    const isHrManager = roleOf(res) === 'hr_manager';
    const usesCompensation = placeholdersIn(body).some((placeholder) =>
      COMPENSATION_PLACEHOLDERS.includes(placeholder),
    );
    if (usesCompensation && !isHrManager) {
      res.status(403).json({
        error: 'Only HR managers can preview templates that use compensation placeholders.',
      });
      return;
    }

    const hire = db
      .prepare(
        `SELECT n.first_name, n.last_name, n.job_title, n.department, n.start_date,
                r.number AS requisition_number
         FROM new_hires n
         LEFT JOIN requisitions r ON r.id = n.requisition_id
         WHERE n.id = ?`,
      )
      .get(newHireId);
    if (!hire) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }

    const values = new Map<string, string>([
      ['firstName', String(hire.first_name)],
      ['lastName', String(hire.last_name)],
      ['jobTitle', String(hire.job_title)],
      ['department', String(hire.department)],
      ['startDate', formatStartDate(String(hire.start_date))],
    ]);
    if (hire.requisition_number !== null) {
      values.set('requisitionNumber', String(hire.requisition_number));
    }
    // AB#letter-templates, criterion 7: compensation values are read only for hr_manager.
    if (isHrManager) {
      const compensation = readCompensation(db, newHireId);
      if (compensation) {
        values.set('baseSalary', formatThousands(compensation.baseSalary));
        values.set('currency', compensation.currency);
      }
    }

    res.json(renderTemplate(body, values));
  });

  router.use(onBodyError);

  return router;
}
