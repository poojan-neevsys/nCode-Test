import express, { type ErrorRequestHandler, Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  readCompensation,
  saveCompensation,
  validateCompensation,
  type CompensationRecord,
} from './compensation.js';
import { findLinkableRequisition } from './requisitions.js';
import { type PortalRole, requireHrManager, roleOf } from './roles.js';

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
export function todayIsoDate(): string {
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

// AB#comp-view, criterion 3: the detail view adds the requisition number and, for hr_manager only, compensation.
export interface NewHireDetail extends NewHireRecord {
  requisitionNumber: string | null;
  compensation?: CompensationRecord | null;
}

// Ids come from the URL. Anything that is not a positive whole number is treated as unknown.
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Express types the route parameter as string | string[]; only a single string can be an id.
export function idParam(raw: string | string[] | undefined): number | null {
  return typeof raw === 'string' ? parseId(raw) : null;
}

// Malformed JSON bodies get a 400 in the same shape as validation errors.
export const onBodyError: ErrorRequestHandler = (err, _req, res, next) => {
  if (typeof err === 'object' && err !== null && (err as { type?: unknown }).type === 'entity.parse.failed') {
    res.status(400).json({ errors: { body: 'Request body must be valid JSON.' } });
    return;
  }
  next(err);
};

// AB#status-workflow, criterion 1: the statuses a new hire can have.
export const STATUSES = ['draft', 'in_review', 'returned', 'approved'] as const;
export type Status = (typeof STATUSES)[number];

// AB#status-workflow: the actions, who may perform each one, and the statuses it moves from and to.
export const ACTIONS = ['submit', 'approve', 'return'] as const;
export type Action = (typeof ACTIONS)[number];

interface ActionRule {
  roles: readonly PortalRole[];
  from: readonly Status[];
  to: Status;
}

const ACTION_RULES: Record<Action, ActionRule> = {
  submit: { roles: ['hr_coordinator', 'hr_manager'], from: ['draft', 'returned'], to: 'in_review' },
  approve: { roles: ['hr_manager'], from: ['in_review'], to: 'approved' },
  return: { roles: ['hr_manager'], from: ['in_review'], to: 'returned' },
};

// AB#status-workflow, criterion 6: a return comment is required and limited to 500 characters.
const COMMENT_MAX_LENGTH = 500;

function isAction(value: unknown): value is Action {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

// Actions the role may perform from the given status.
function allowedActionsFor(role: PortalRole, status: string): Action[] {
  return ACTIONS.filter(
    (action) =>
      ACTION_RULES[action].roles.includes(role) &&
      (ACTION_RULES[action].from as readonly string[]).includes(status),
  );
}

function objectOf(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

interface ActionRequest {
  action: Action;
  expectedStatus: string;
  comment: string | null;
}

// Checks the action body and reports every invalid field. Nothing is changed on failure.
function validateActionRequest(
  source: Record<string, unknown>,
  action: Action,
): { request: ActionRequest } | { errors: Partial<Record<'expectedStatus' | 'comment', string>> } {
  const errors: Partial<Record<'expectedStatus' | 'comment', string>> = {};

  const expectedStatus = source.expectedStatus;
  if (typeof expectedStatus !== 'string' || expectedStatus.trim() === '') {
    errors.expectedStatus = 'Send the status the new hire currently has.';
  }

  let comment: string | null = null;
  const rawComment = source.comment;
  if (rawComment !== undefined && rawComment !== null) {
    if (typeof rawComment !== 'string') {
      errors.comment = 'Enter the comment as text.';
    } else {
      // AB#status-workflow, criterion 6: the length is checked on the raw comment, before trimming.
      if (Array.from(rawComment).length > COMMENT_MAX_LENGTH) {
        errors.comment = `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.`;
      } else if (rawComment.trim() !== '') {
        comment = rawComment.trim();
      }
    }
  }
  // AB#status-workflow, criterion 6: returning a new hire needs a comment.
  if (action === 'return' && comment === null && errors.comment === undefined) {
    errors.comment = 'Enter a comment explaining what needs to change.';
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { request: { action, expectedStatus: expectedStatus as string, comment } };
}

// AB#status-workflow, criteria 5 and 6: conditions that block an action. Every failing reason is returned.
function actionBlockers(db: DatabaseSync, id: number, action: Action): string[] {
  const reasons: string[] = [];
  if (action === 'submit') {
    const row = db.prepare('SELECT requisition_id, start_date FROM new_hires WHERE id = ?').get(id);
    if (!row) {
      return ['The new hire could not be found.'];
    }
    if (row.requisition_id === null) {
      reasons.push('The new hire must be linked to a requisition before it is submitted.');
    }
    if (String(row.start_date) < todayIsoDate()) {
      reasons.push('The start date is before today. Set a start date from today onward.');
    }
  }
  if (action === 'approve' && readCompensation(db, id) === null) {
    reasons.push('Compensation is required before approval.');
  }
  return reasons;
}

// AB#status-workflow, criterion 2: the status change and its history entry are written in one transaction.
// Returns false when the status was no longer the expected one, so nothing is written.
function recordTransition(
  db: DatabaseSync,
  id: number,
  from: Status,
  request: ActionRequest,
  role: PortalRole,
): boolean {
  const to = ACTION_RULES[request.action].to;
  db.exec('BEGIN IMMEDIATE');
  try {
    const updated = db
      .prepare(
        `UPDATE new_hires
         SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = ?`,
      )
      .run(to, id, from);
    if (Number(updated.changes) !== 1) {
      db.exec('ROLLBACK');
      return false;
    }
    db.prepare(
      `INSERT INTO new_hire_status_history (new_hire_id, from_status, to_status, action, role, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, from, to, request.action, role, request.comment);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// AB#status-workflow, criterion 7: history rows for one new hire, oldest first.
export interface StatusHistoryEntry {
  id: number;
  fromStatus: string;
  toStatus: string;
  action: string;
  role: string;
  comment: string | null;
  createdAt: string;
}

function toHistoryEntry(row: Row): StatusHistoryEntry {
  return {
    id: Number(row.id),
    fromStatus: String(row.from_status),
    toStatus: String(row.to_status),
    action: String(row.action),
    role: String(row.role),
    comment: row.comment === null ? null : String(row.comment),
    createdAt: String(row.created_at),
  };
}

function readStatus(db: DatabaseSync, id: number): string | null {
  const row = db.prepare('SELECT status FROM new_hires WHERE id = ?').get(id);
  return row ? String(row.status) : null;
}

// The detail view for one role. Compensation is included for hr_manager only.
function readDetail(db: DatabaseSync, id: number, role: PortalRole): NewHireDetail | null {
  const row = db
    .prepare(
      `SELECT n.id, n.first_name, n.last_name, n.personal_email, n.job_title, n.department,
              n.start_date, n.status, n.requisition_id, n.created_at, n.updated_at,
              r.number AS requisition_number
       FROM new_hires n
       LEFT JOIN requisitions r ON r.id = n.requisition_id
       WHERE n.id = ?`,
    )
    .get(id);
  if (!row) {
    return null;
  }

  const record: NewHireDetail = {
    ...toRecord(row),
    requisitionNumber: row.requisition_number === null ? null : String(row.requisition_number),
  };
  // AB#comp-view, criterion 3: the compensation field is added for hr_manager only, so it is absent otherwise.
  if (role === 'hr_manager') {
    record.compensation = readCompensation(db, id);
  }
  return record;
}

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

  // AB#comp-view, criteria 1, 2 and 3: full record with requisition number; unknown id gives 404.
  router.get('/:id', (req, res) => {
    const id = idParam(req.params.id);
    const record = id === null ? null : readDetail(db, id, roleOf(res));
    if (!record) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }
    res.json(record);
  });

  // AB#status-workflow, criterion 7: the status history, oldest first. Unknown id gives 404.
  router.get('/:id/history', (req, res) => {
    const id = idParam(req.params.id);
    if (id === null || readStatus(db, id) === null) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }
    const rows = db
      .prepare(
        `SELECT id, from_status, to_status, action, role, comment, created_at
         FROM new_hire_status_history
         WHERE new_hire_id = ?
         ORDER BY id ASC`,
      )
      .all(id);
    res.json(rows.map(toHistoryEntry));
  });

  // AB#status-workflow, criteria 2 to 6: submit, approve or return a new hire.
  // Order of checks: unknown id (404), unknown action (400), role (403), body (400),
  // stale expectedStatus (409), status not allowed for the action (409), blocking conditions (409).
  router.post('/:id/actions', express.json(), (req, res) => {
    const id = idParam(req.params.id);
    const current = id === null ? null : readStatus(db, id);
    if (id === null || current === null) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }

    const source = objectOf(req.body);
    if (!isAction(source.action)) {
      res.status(400).json({ errors: { action: `Choose one of: ${ACTIONS.join(', ')}.` } });
      return;
    }
    const action = source.action;

    // AB#status-workflow, criterion 4: an action the role may never perform gets 403 and changes nothing.
    const role = roleOf(res);
    if (!ACTION_RULES[action].roles.includes(role)) {
      res.status(403).json({ error: 'Your role cannot perform this action.' });
      return;
    }

    const validation = validateActionRequest(source, action);
    if ('errors' in validation) {
      res.status(400).json({ errors: validation.errors });
      return;
    }
    const { request } = validation;

    // AB#status-workflow, criterion 5: a stale view gets 409 with the current status.
    if (request.expectedStatus !== current) {
      res.status(409).json({
        error: 'The new hire has changed since it was loaded. Reload to see its current status.',
        currentStatus: current,
        allowedActions: allowedActionsFor(role, current),
      });
      return;
    }

    // AB#status-workflow, criterion 3: an action not allowed from the current status gets 409.
    if (!(ACTION_RULES[action].from as readonly string[]).includes(current)) {
      res.status(409).json({
        error: 'This action is not allowed from the current status.',
        currentStatus: current,
        allowedActions: allowedActionsFor(role, current),
      });
      return;
    }

    // AB#status-workflow, criterion 6: submit and approve list every reason they are blocked.
    const reasons = actionBlockers(db, id, action);
    if (reasons.length > 0) {
      res.status(409).json({
        error: 'This action cannot be completed yet.',
        reasons,
        currentStatus: current,
        allowedActions: allowedActionsFor(role, current),
      });
      return;
    }

    if (!recordTransition(db, id, current as Status, request, role)) {
      // The status changed between the read above and the write, so nothing was written.
      const latest = readStatus(db, id) ?? current;
      res.status(409).json({
        error: 'The new hire has changed since it was loaded. Reload to see its current status.',
        currentStatus: latest,
        allowedActions: allowedActionsFor(role, latest),
      });
      return;
    }

    const updated = readDetail(db, id, role);
    if (!updated) {
      throw new Error('Updated new hire could not be read back.');
    }
    res.status(200).json(updated);
  });

  // AB#comp-set, criteria 4, 5 and 6: hr_manager creates or replaces compensation; other roles get 403.
  // The role check runs before the body is read, so nothing is parsed or saved for other roles.
  router.put('/:id/compensation', requireHrManager, express.json(), (req, res) => {
    const id = idParam(req.params.id);
    if (id === null || !db.prepare('SELECT id FROM new_hires WHERE id = ?').get(id)) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }

    // AB#comp-validation, criterion 4: nothing is saved when any field is invalid.
    const result = validateCompensation(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    saveCompensation(db, id, result.input);
    const saved = readCompensation(db, id);
    if (!saved) {
      throw new Error('Saved compensation could not be read back.');
    }
    res.status(200).json(saved);
  });

  router.use(onBodyError);

  return router;
}
