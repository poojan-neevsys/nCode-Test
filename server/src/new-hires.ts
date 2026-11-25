import express, { type ErrorRequestHandler, Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { findLinkableRequisition } from './requisitions.js';

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
  requisitionId: number | null;
}

export type NewHireErrors = Partial<Record<NewHireField | 'requisitionId', string>>;

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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

// AB#new-hire-draft, criterion 3: validate on the server and report every invalid field.
export function validateNewHire(body: unknown): { input: NewHireInput } | { errors: NewHireErrors } {
  const source: Record<string, unknown> =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  // AB#requisition-link, criterion 3 and 5: the requisition is optional. Without one, nothing changes.
  const rawRequisitionId = source.requisitionId;
  const linkRequested = rawRequisitionId !== undefined && rawRequisitionId !== null;
  const requisitionId = isPositiveInteger(rawRequisitionId) ? rawRequisitionId : null;

  const input: NewHireInput = {
    firstName: readText(source, 'firstName'),
    lastName: readText(source, 'lastName'),
    personalEmail: readText(source, 'personalEmail'),
    jobTitle: readText(source, 'jobTitle'),
    department: readText(source, 'department'),
    startDate: readText(source, 'startDate'),
    requisitionId,
  };

  const errors: NewHireErrors = {};
  for (const field of REQUIRED_FIELDS) {
    // AB#requisition-link, criterion 3: a linked requisition supplies the job title and department.
    if (requisitionId !== null && (field === 'jobTitle' || field === 'department')) {
      continue;
    }
    if (input[field] === '') {
      errors[field] = 'This field is required.';
    }
  }

  if (linkRequested && requisitionId === null) {
    errors.requisitionId = 'Choose a requisition from the list.';
  }

  if (input.personalEmail !== '' && !EMAIL_PATTERN.test(input.personalEmail)) {
    errors.personalEmail = 'Enter a valid email address.';
  }

  if (
    requisitionId === null &&
    input.department !== '' &&
    !(DEPARTMENTS as readonly string[]).includes(input.department)
  ) {
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
  requisitionId: number | null;
  createdAt: string;
  updatedAt: string;
}

const SELECT_RECORD = `
  SELECT id, first_name, last_name, personal_email, job_title, department,
         start_date, status, requisition_id, created_at, updated_at
  FROM new_hires`;

type Row = Record<string, unknown>;

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
    requisitionId: row.requisition_id === null ? null : Number(row.requisition_id),
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
    // AB#requisition-link, criterion 7: the requisition number is shown, or null when not linked.
    const rows = db
      .prepare(
        `SELECT n.id, n.first_name, n.last_name, n.job_title, n.department, n.start_date, n.status,
                r.number AS requisition_number
         FROM new_hires n
         LEFT JOIN requisitions r ON r.id = n.requisition_id
         ORDER BY n.created_at DESC, n.id DESC`,
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
        requisitionNumber: row.requisition_number === null ? null : String(row.requisition_number),
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
    let jobTitle = input.jobTitle;
    let department = input.department;
    if (input.requisitionId !== null) {
      // AB#requisition-link, criteria 3 and 4: the requisition must be open and not linked yet.
      // Its job title and department replace whatever was sent.
      const linkable = findLinkableRequisition(db, input.requisitionId);
      if ('error' in linkable) {
        res.status(400).json({ errors: { requisitionId: linkable.error } });
        return;
      }
      jobTitle = linkable.requisition.jobTitle;
      department = linkable.requisition.department;
    }

    const inserted = db
      .prepare(
        `INSERT INTO new_hires
           (first_name, last_name, personal_email, job_title, department, start_date, requisition_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
      )
      .run(
        input.firstName,
        input.lastName,
        input.personalEmail,
        jobTitle,
        department,
        input.startDate,
        input.requisitionId,
      );

    const row = db.prepare(`${SELECT_RECORD} WHERE id = ?`).get(Number(inserted.lastInsertRowid));
    if (!row) {
      throw new Error('Saved new hire could not be read back.');
    }
    res.status(201).json(toRecord(row));
  });

  router.use(onBodyError);

  return router;
}
