import express, { type ErrorRequestHandler, Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { inTransaction, writeAudit } from './audit.js';
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

// AB#requisition-link, criteria 3 and 4 (create and edit): a linked requisition must be open and not linked
// to another new hire, and its job title and department replace whatever was sent.
function resolveFields(
  db: DatabaseSync,
  input: NewHireInput,
  exceptNewHireId?: number,
): { jobTitle: string; department: string } | { error: string } {
  if (input.requisitionId === null) {
    return { jobTitle: input.jobTitle, department: input.department };
  }
  const linkable = findLinkableRequisition(db, input.requisitionId, exceptNewHireId);
  if ('error' in linkable) {
    return { error: linkable.error };
  }
  return {
    jobTitle: linkable.requisition.jobTitle,
    department: linkable.requisition.department,
  };
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
  // AB#edit-hold-release, criterion 4: the reason the new hire is on hold, or null.
  holdReason: string | null;
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

// AB#status-workflow, criterion 1 and AB#edit-hold-release, criterion 4: the statuses a new hire can have.
export const STATUSES = ['draft', 'in_review', 'returned', 'approved', 'on_hold', 'released'] as const;
export type Status = (typeof STATUSES)[number];

// AB#edit-hold-release, criterion 2: only these statuses can be edited.
const EDITABLE_STATUSES: readonly Status[] = ['draft', 'returned'];

// AB#edit-hold-release, criterion 2: the fields an edit can change. The audit entry lists the ones that changed.
const EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'personalEmail',
  'jobTitle',
  'department',
  'startDate',
  'requisitionId',
] as const;

// AB#status-workflow: the actions, who may perform each one, and the statuses it moves from and to.
// AB#edit-hold-release, criteria 4 to 6: hold, resume and release.
export const ACTIONS = ['submit', 'approve', 'return', 'hold', 'resume', 'release'] as const;
export type Action = (typeof ACTIONS)[number];

interface ActionRule {
  roles: readonly PortalRole[];
  from: readonly Status[];
  // null means the status is read from the record: resume returns to the status before the hold.
  to: Status | null;
}

const ACTION_RULES: Record<Action, ActionRule> = {
  submit: { roles: ['hr_coordinator', 'hr_manager'], from: ['draft', 'returned'], to: 'in_review' },
  approve: { roles: ['hr_manager'], from: ['in_review'], to: 'approved' },
  return: { roles: ['hr_manager'], from: ['in_review'], to: 'returned' },
  // AB#edit-hold-release, criterion 4: hold from in_review or approved; the reason is required.
  hold: { roles: ['hr_manager'], from: ['in_review', 'approved'], to: 'on_hold' },
  // AB#edit-hold-release, criterion 5: resume from on_hold, back to the status before the hold.
  resume: { roles: ['hr_manager'], from: ['on_hold'], to: null },
  // AB#edit-hold-release, criterion 6: release from approved. Released is final.
  release: { roles: ['hr_manager'], from: ['approved'], to: 'released' },
};

// AB#status-workflow, criterion 6: a return comment is required and limited to 500 characters.
// AB#edit-hold-release, criterion 4: the same limit applies to the hold reason.
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
  // The return comment or the hold reason. Null for the other actions.
  comment: string | null;
}

// Checks the action body and reports every invalid field. Nothing is changed on failure.
// The hold reason is sent in `reason`; the return comment is sent in `comment`.
function validateActionRequest(
  source: Record<string, unknown>,
  action: Action,
): { request: ActionRequest } | { errors: Partial<Record<'expectedStatus' | 'comment' | 'reason', string>> } {
  const errors: Partial<Record<'expectedStatus' | 'comment' | 'reason', string>> = {};

  const expectedStatus = source.expectedStatus;
  if (typeof expectedStatus !== 'string' || expectedStatus.trim() === '') {
    errors.expectedStatus = 'Send the status the new hire currently has.';
  }

  const field: 'comment' | 'reason' = action === 'hold' ? 'reason' : 'comment';
  let comment: string | null = null;
  const rawText = source[field];
  if (rawText !== undefined && rawText !== null) {
    if (typeof rawText !== 'string') {
      errors[field] = action === 'hold' ? 'Enter the reason as text.' : 'Enter the comment as text.';
    } else {
      // AB#status-workflow, criterion 6: the length is checked on the raw text, before trimming.
      if (Array.from(rawText).length > COMMENT_MAX_LENGTH) {
        errors[field] = `Must be ${COMMENT_MAX_LENGTH} characters or fewer.`;
      } else if (rawText.trim() !== '') {
        comment = rawText.trim();
      }
    }
  }
  // AB#status-workflow, criterion 6: returning a new hire needs a comment.
  // AB#edit-hold-release, criterion 4: holding a new hire needs a reason.
  if (action === 'return' && comment === null && errors[field] === undefined) {
    errors[field] = 'Enter a comment explaining what needs to change.';
  }
  if (action === 'hold' && comment === null && errors[field] === undefined) {
    errors[field] = 'Enter a reason for the hold.';
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
  // AB#edit-hold-release, criterion 6: a new hire whose start date has passed cannot be released.
  if (action === 'release') {
    const row = db.prepare('SELECT start_date FROM new_hires WHERE id = ?').get(id);
    if (row && String(row.start_date) < todayIsoDate()) {
      reasons.push('The start date is before today, so the new hire cannot be released.');
    }
  }
  return reasons;
}

// AB#edit-hold-release, criterion 5: the status a resume returns to. Other actions use the rule's status.
function targetStatus(db: DatabaseSync, id: number, action: Action): Status {
  if (action === 'resume') {
    const row = db.prepare('SELECT status_before_hold FROM new_hires WHERE id = ?').get(id);
    const previous = String(row?.status_before_hold ?? '');
    if (previous === 'in_review' || previous === 'approved') {
      return previous;
    }
    throw new Error('A held new hire has no status to return to.');
  }
  const to = ACTION_RULES[action].to;
  if (to === null) {
    throw new Error(`Action ${action} has no target status.`);
  }
  return to;
}

// AB#status-workflow, criterion 2 and AB#edit-hold-release, criterion 8: the status change, its history entry
// and its audit entry are written in one transaction.
// Returns false when the status was no longer the expected one, so nothing is written.
function recordTransition(
  db: DatabaseSync,
  id: number,
  from: Status,
  to: Status,
  request: ActionRequest,
  role: PortalRole,
): boolean {
  return inTransaction(db, () => {
    const holding = request.action === 'hold';
    const updated = db
      .prepare(
        `UPDATE new_hires
         SET status = ?, hold_reason = ?, status_before_hold = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = ?`,
      )
      .run(to, holding ? request.comment : null, holding ? from : null, id, from);
    if (Number(updated.changes) !== 1) {
      return false;
    }
    db.prepare(
      `INSERT INTO new_hire_status_history (new_hire_id, from_status, to_status, action, role, comment)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, from, to, request.action, role, request.comment);
    writeAudit(db, {
      entityType: 'new_hire',
      entityId: id,
      action: request.action,
      role,
      details: { fromStatus: from, toStatus: to, comment: request.comment },
    });
    return true;
  });
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

// AB#edit-hold-release, criterion 8: the fields that differ between the saved record and the edited one.
// Field names are listed with their old and new values. Compensation is never part of this.
function fieldChanges(
  before: NewHireRecord,
  after: NewHireRecord,
): { field: string; from: string | number | null; to: string | number | null }[] {
  return EDITABLE_FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    from: before[field],
    to: after[field],
  }));
}

// The detail view for one role. Compensation is included for hr_manager only.
function readDetail(db: DatabaseSync, id: number, role: PortalRole): NewHireDetail | null {
  const row = db
    .prepare(
      `SELECT n.id, n.first_name, n.last_name, n.personal_email, n.job_title, n.department,
              n.start_date, n.status, n.requisition_id, n.created_at, n.updated_at,
              n.hold_reason, r.number AS requisition_number
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
    holdReason: row.hold_reason === null ? null : String(row.hold_reason),
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
  // AB#edit-hold-release, criterion 8: the create and its audit entry are saved in one transaction.
  router.post('/', express.json(), (req, res) => {
    const result = validateNewHire(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    const { input } = result;
    // AB#requisition-link, criteria 3 and 4: the requisition must be open and not linked yet.
    const resolved = resolveFields(db, input);
    if ('error' in resolved) {
      res.status(400).json({ errors: { requisitionId: resolved.error } });
      return;
    }

    const role = roleOf(res);
    const newId = inTransaction(db, () => {
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
          resolved.jobTitle,
          resolved.department,
          input.startDate,
          input.requisitionId,
        );
      const createdId = Number(inserted.lastInsertRowid);
      writeAudit(db, {
        entityType: 'new_hire',
        entityId: createdId,
        action: 'create',
        role,
        details: { toStatus: 'draft' },
      });
      return createdId;
    });

    const row = db.prepare(`${SELECT_RECORD} WHERE id = ?`).get(newId);
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

  // AB#edit-hold-release, criteria 2 and 3: edit a draft or returned new hire. Either role may edit.
  // Order of checks: unknown id (404), status or expectedStatus not editable (409), validation (400),
  // requisition rules (400), stale save (409).
  router.put('/:id', express.json(), (req, res) => {
    const id = idParam(req.params.id);
    const current = id === null ? null : readStatus(db, id);
    if (id === null || current === null) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }

    const source = objectOf(req.body);
    const editable = (EDITABLE_STATUSES as readonly string[]).includes(current);
    if (!editable) {
      res.status(409).json({
        error: 'Only draft or returned new hires can be edited.',
        currentStatus: current,
      });
      return;
    }
    if (source.expectedStatus !== current) {
      res.status(409).json({
        error: 'The new hire has changed since it was loaded. Reload to see its current status.',
        currentStatus: current,
      });
      return;
    }

    const result = validateNewHire(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }
    const { input } = result;
    const resolved = resolveFields(db, input, id);
    if ('error' in resolved) {
      res.status(400).json({ errors: { requisitionId: resolved.error } });
      return;
    }

    const role = roleOf(res);
    const saved = inTransaction(db, () => {
      const beforeRow = db.prepare(`${SELECT_RECORD} WHERE id = ?`).get(id);
      if (!beforeRow || String(beforeRow.status) !== current) {
        return false;
      }
      const before = toRecord(beforeRow);
      const after: NewHireRecord = {
        ...before,
        firstName: input.firstName,
        lastName: input.lastName,
        personalEmail: input.personalEmail,
        jobTitle: resolved.jobTitle,
        department: resolved.department,
        startDate: input.startDate,
        requisitionId: input.requisitionId,
      };
      const updated = db
        .prepare(
          `UPDATE new_hires
           SET first_name = ?, last_name = ?, personal_email = ?, job_title = ?, department = ?,
               start_date = ?, requisition_id = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND status = ?`,
        )
        .run(
          after.firstName,
          after.lastName,
          after.personalEmail,
          after.jobTitle,
          after.department,
          after.startDate,
          after.requisitionId,
          id,
          current,
        );
      if (Number(updated.changes) !== 1) {
        return false;
      }
      writeAudit(db, {
        entityType: 'new_hire',
        entityId: id,
        action: 'edit',
        role,
        details: { changes: fieldChanges(before, after) },
      });
      return true;
    });

    if (!saved) {
      // The status changed between the read above and the write, so nothing was written.
      const latest = readStatus(db, id) ?? current;
      res.status(409).json({
        error: 'The new hire has changed since it was loaded. Reload to see its current status.',
        currentStatus: latest,
      });
      return;
    }

    const updatedDetail = readDetail(db, id, role);
    if (!updatedDetail) {
      throw new Error('Updated new hire could not be read back.');
    }
    res.status(200).json(updatedDetail);
  });

  // AB#status-workflow, criteria 2 to 6 and AB#edit-hold-release, criteria 4 to 6:
  // submit, approve, return, hold, resume or release a new hire.
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
    // AB#edit-hold-release, criterion 7: hold, resume and release are hr_manager only.
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
    // AB#edit-hold-release, criterion 6: release lists why it is blocked.
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

    const to = targetStatus(db, id, action);
    if (!recordTransition(db, id, current as Status, to, request, role)) {
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
    const current = id === null ? null : readStatus(db, id);
    if (id === null || current === null) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }

    // AB#edit-hold-release, criterion 6: a released new hire is final, so its compensation is not changed either.
    if (current === 'released') {
      res.status(409).json({ error: 'A released new hire cannot be changed.', currentStatus: current });
      return;
    }

    // AB#comp-validation, criterion 4: nothing is saved when any field is invalid.
    const result = validateCompensation(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }
    const input = result.input;

    // AB#edit-hold-release, criterion 8: the audit entry records only that compensation changed, never the amounts.
    const role = roleOf(res);
    inTransaction(db, () => {
      saveCompensation(db, id, input);
      writeAudit(db, {
        entityType: 'new_hire',
        entityId: id,
        action: 'compensation',
        role,
        details: { changes: [{ field: 'compensation' }] },
      });
    });
    const saved = readCompensation(db, id);
    if (!saved) {
      throw new Error('Saved compensation could not be read back.');
    }
    res.status(200).json(saved);
  });

  router.use(onBodyError);

  return router;
}
