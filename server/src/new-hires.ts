import express, { type ErrorRequestHandler, Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { readRole, requireHrManager } from './roles.js';

// AB#new-hire-draft: the departments a new hire can be assigned to.
export const DEPARTMENTS = ['Engineering', 'Finance', 'HR', 'Operations', 'Sales'] as const;

const REQUIRED_FIELDS = [
  'firstName',
  'lastName',
  'personalEmail',
  'jobTitle',
  'department',
  'startDate',
] as const;

export type NewHireField = (typeof REQUIRED_FIELDS)[number];

export interface NewHireInput {
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
}

export type NewHireErrors = Partial<Record<NewHireField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Local calendar date of the server as YYYY-MM-DD.
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// True only for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30).
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function readText(source: Record<string, unknown>, field: NewHireField): string {
  const value = source[field];
  return typeof value === 'string' ? value.trim() : '';
}

// AB#new-hire-draft, criterion 3: validate on the server and report every invalid field.
export function validateNewHire(body: unknown): { input: NewHireInput } | { errors: NewHireErrors } {
  const source: Record<string, unknown> =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const input: NewHireInput = {
    firstName: readText(source, 'firstName'),
    lastName: readText(source, 'lastName'),
    personalEmail: readText(source, 'personalEmail'),
    jobTitle: readText(source, 'jobTitle'),
    department: readText(source, 'department'),
    startDate: readText(source, 'startDate'),
  };

  const errors: NewHireErrors = {};
  for (const field of REQUIRED_FIELDS) {
    if (input[field] === '') {
      errors[field] = 'This field is required.';
    }
  }

  if (input.personalEmail !== '' && !EMAIL_PATTERN.test(input.personalEmail)) {
    errors.personalEmail = 'Enter a valid email address.';
  }

  if (input.department !== '' && !(DEPARTMENTS as readonly string[]).includes(input.department)) {
    errors.department = `Choose one of: ${DEPARTMENTS.join(', ')}.`;
  }

  if (input.startDate !== '') {
    if (!isRealIsoDate(input.startDate)) {
      errors.startDate = 'Enter a valid date in the format YYYY-MM-DD.';
    } else if (input.startDate < todayIsoDate()) {
      // YYYY-MM-DD strings compare correctly as text.
      errors.startDate = 'Start date cannot be before today.';
    }
  }

  return Object.keys(errors).length > 0 ? { errors } : { input };
}

export interface NewHireRecord {
  id: number;
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const CURRENCIES = ['USD', 'INR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface CompensationInput {
  baseSalary: number;
  currency: Currency;
  bonusTargetPercent: number | null;
}

export type CompensationField = keyof CompensationInput;
export type CompensationErrors = Partial<Record<CompensationField, string>>;

export interface CompensationRecord {
  baseSalary: number;
  currency: string;
  bonusTargetPercent: number | null;
  updatedAt: string;
}

const MAX_BASE_SALARY = 10000000;

// AB#new-hire-compensation, criterion 5: validate on the server and report every invalid field.
// Values are never copied into error messages.
export function validateCompensation(
  body: unknown,
): { input: CompensationInput } | { errors: CompensationErrors } {
  const source: Record<string, unknown> =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  const errors: CompensationErrors = {};

  const baseSalary = source.baseSalary;
  if (
    typeof baseSalary !== 'number' ||
    !Number.isInteger(baseSalary) ||
    baseSalary < 1 ||
    baseSalary > MAX_BASE_SALARY
  ) {
    errors.baseSalary = `Enter a whole number from 1 to ${MAX_BASE_SALARY}.`;
  }

  const currency = source.currency;
  if (typeof currency !== 'string' || !(CURRENCIES as readonly string[]).includes(currency)) {
    errors.currency = `Choose one of: ${CURRENCIES.join(', ')}.`;
  }

  // The bonus target is optional: a missing or null value means no bonus target.
  const bonus = source.bonusTargetPercent ?? null;
  if (
    bonus !== null &&
    (typeof bonus !== 'number' || !Number.isFinite(bonus) || bonus < 0 || bonus > 100)
  ) {
    errors.bonusTargetPercent = 'Enter a number from 0 to 100, or leave it empty.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return {
    input: {
      baseSalary: baseSalary as number,
      currency: currency as Currency,
      bonusTargetPercent: bonus as number | null,
    },
  };
}

const SELECT_RECORD = `
  SELECT id, first_name, last_name, personal_email, job_title, department,
         start_date, status, created_at, updated_at
  FROM new_hires`;

const SELECT_COMPENSATION = `
  SELECT base_salary, currency, bonus_target_percent, updated_at
  FROM new_hire_compensation
  WHERE new_hire_id = ?`;

type Row = Record<string, unknown>;

function toCompensation(row: Row): CompensationRecord {
  return {
    baseSalary: Number(row.base_salary),
    currency: String(row.currency),
    bonusTargetPercent: row.bonus_target_percent === null ? null : Number(row.bonus_target_percent),
    updatedAt: String(row.updated_at),
  };
}

// Route ids must be positive whole numbers; anything else is treated as not found.
// Express types req.params values as string | string[], so anything that is not a single string is rejected.
function parseId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

function toRecord(row: Row): NewHireRecord {
  return {
    id: Number(row.id),
    firstName: String(row.first_name),
    lastName: String(row.last_name),
    personalEmail: String(row.personal_email),
    jobTitle: String(row.job_title),
    department: String(row.department),
    startDate: String(row.start_date),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// Malformed JSON bodies get a 400 in the same shape as validation errors.
const onBodyError: ErrorRequestHandler = (err, _req, res, next) => {
  if (typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.parse.failed') {
    res.status(400).json({ errors: { body: 'Request body must be valid JSON.' } });
    return;
  }
  next(err);
};

export function createNewHiresRouter(db: DatabaseSync): Router {
  const router = Router();

  // AB#new-hire-draft, criterion 5: newest first, with the fields the list shows.
  router.get('/', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, first_name, last_name, job_title, department, start_date, status
         FROM new_hires
         ORDER BY created_at DESC, id DESC`,
      )
      .all();
    res.json(
      rows.map((row) => ({
        id: Number(row.id),
        fullName: `${String(row.first_name)} ${String(row.last_name)}`,
        jobTitle: String(row.job_title),
        department: String(row.department),
        startDate: String(row.start_date),
        status: String(row.status),
      })),
    );
  });

  // AB#new-hire-draft, criteria 2 and 3: save a draft, or return 400 and save nothing.
  router.post('/', express.json(), (req, res) => {
    const result = validateNewHire(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    const { input } = result;
    const inserted = db
      .prepare(
        `INSERT INTO new_hires
           (first_name, last_name, personal_email, job_title, department, start_date, status)
         VALUES (?, ?, ?, ?, ?, ?, 'draft')`,
      )
      .run(
        input.firstName,
        input.lastName,
        input.personalEmail,
        input.jobTitle,
        input.department,
        input.startDate,
      );

    const row = db.prepare(`${SELECT_RECORD} WHERE id = ?`).get(Number(inserted.lastInsertRowid));
    if (!row) {
      throw new Error('Saved new hire could not be read back.');
    }
    res.status(201).json(toRecord(row));
  });

  // AB#new-hire-compensation, criteria 3 and 4: the full record. Compensation is included
  // only for hr_manager; for hr_coordinator the field is absent. Unknown ids get 404.
  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    const row = id === null ? undefined : db.prepare(`${SELECT_RECORD} WHERE id = ?`).get(id);
    if (id === null || !row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const body: NewHireRecord & { compensation?: CompensationRecord | null } = toRecord(row);
    if (readRole(req) === 'hr_manager') {
      const compensation = db.prepare(SELECT_COMPENSATION).get(id);
      body.compensation = compensation ? toCompensation(compensation) : null;
    }
    res.json(body);
  });

  // AB#new-hire-compensation, criteria 4 to 6: hr_manager creates or replaces the compensation.
  // The role check runs before the body is read, so coordinators get 403 whatever they send.
  router.put('/:id/compensation', requireHrManager, express.json(), (req, res) => {
    const id = parseId(req.params.id);
    const exists =
      id === null ? undefined : db.prepare('SELECT id FROM new_hires WHERE id = ?').get(id);
    if (id === null || !exists) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const result = validateCompensation(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    const { input } = result;
    db.prepare(
      `INSERT INTO new_hire_compensation
         (new_hire_id, base_salary, currency, bonus_target_percent)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (new_hire_id) DO UPDATE SET
         base_salary = excluded.base_salary,
         currency = excluded.currency,
         bonus_target_percent = excluded.bonus_target_percent,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).run(id, input.baseSalary, input.currency, input.bonusTargetPercent);

    const saved = db.prepare(SELECT_COMPENSATION).get(id);
    if (!saved) {
      throw new Error('Saved compensation could not be read back.');
    }
    res.status(200).json({ newHireId: id, ...toCompensation(saved) });
  });

  router.use(onBodyError);

  return router;
}
