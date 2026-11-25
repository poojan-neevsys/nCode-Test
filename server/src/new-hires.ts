import express, { type ErrorRequestHandler, Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { writeAudit } from './audit.js';
import { inTransaction } from './db.js';
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
// AB#hold-release, criterion 4: the detail view carries the hold reason. AB#new-hire-edit: the requisition's hiring manager.
export interface NewHireDetail extends NewHireRecord {
  requisitionNumber: string | null;
  requisitionHiringManager: string | null;
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

// AB#status-workflow, criterion 1 and AB#hold-release, criterion 1: the statuses a new hire can have.
export const STATUSES = ['draft', 'in_review', 'returned', 'approved', 'on_hold', 'released'] as const;
export type Status = (typeof STATUSES)[number];

// AB#status-workflow and AB#hold-release: the actions, who may perform each one, and the statuses it moves from and to.
export const ACTIONS = ['submit', 'approve', 'return', 'hold', 'resume', 'release'] as const;
export type Action = (typeof ACTIONS)[number];

interface ActionRule {
  roles: readonly PortalRole[];
  from: readonly Status[];
  // null means the status the new hire had before the hold (AB#hold-release, criterion 5).
  to: Status | null;
}

const ACTION_RULES: Record<Action, ActionRule> = {
  submit: { roles: ['hr_coordinator', 'hr_manager'], from: ['draft', 'returned'], to: 'in_review' },
  approve: { roles: ['hr_manager'], from: ['in_review'], to: 'approved' },
  return: { roles: ['hr_manager'], from: ['in_review'], to: 'returned' },
  // AB#hold-release, criterion 4: hold from in_review or approved.
  hold: { roles: ['hr_manager'], from: ['in_review', 'approved'], to: 'on_hold' },
  // AB#hold-release, criterion 5: resume returns to exactly the status held from.
  resume: { roles: ['hr_manager'], from: ['on_hold'], to: null },
  // AB#hold-release, criterion 6: release moves an approved new hire to released, which is final.
  release: { roles: ['hr_manager'], from: ['approved'], to: 'released' },
};

// The workflow actions are also written to new_hire_status_history. Its CHECK constraints do not
// allow the hold actions, so those are recorded in the audit log only.
const HISTORY_ACTIONS: readonly Action[] = ['submit', 'approve', 'return'];

// AB#new-hire-edit, criterion 2: only draft and returned new hires can be edited.
const EDITABLE_STATUSES: readonly Status[] = ['draft', 'returned'];

// AB#status-workflow, criterion 6: a return comment is required and limited to 500 characters.
// AB#hold-release, criterion 4: the hold reason uses the same limit.
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
  // The comment for return, or the reason for hold.
  comment: string | null;
}

type ActionErrorField = 'expectedStatus' | 'comment' | 'reason';

// Checks the action body and reports every invalid field. Nothing is changed on failure.
function validateActionRequest(
  source: Record<string, unknown>,
  action: Action,
): { request: ActionRequest } | { errors: Partial<Record<ActionErrorField, string>> } {
  const errors: Partial<Record<ActionErrorField, string>> = {};

  const expectedStatus = source.expectedStatus;
  if (typeof expectedStatus !== 'string' || expectedStatus.trim() === '') {
    errors.expectedStatus = 'Send the status the new hire currently has.';
  }

  let comment: string | null = null;
  if (action === 'hold') {
    // AB#hold-release, criterion 4: the reason is required and limited to 500 characters.
    const rawReason = source.reason;
    if (typeof rawReason !== 'string' || rawReason.trim() === '') {
      errors.reason = 'Enter the reason for the hold.';
    } else if (Array.from(rawReason).length > COMMENT_MAX_LENGTH) {
      errors.reason = `Reason must be ${COMMENT_MAX_LENGTH} characters or fewer.`;
    } else {
      comment = rawReason.trim();
    }
  } else {
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
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return { request: { action, expectedStatus: expectedStatus as string, comment } };
}

// AB#status-workflow, criteria 5 and 6 and AB#hold-release, criterion 6: conditions that block an action. Every failing reason is returned.
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
  // AB#hold-release, criterion 6: a new hire whose start date has passed cannot be released.
  if (action === 'release') {
    const row = db.prepare('SELECT start_date FROM new_hires WHERE id = ?').get(id);
    if (row && String(row.start_date) < todayIsoDate()) {
      reasons.push('The start date is before today, so the new hire cannot be released. Change the start date first.');
    }
  }
  return reasons;
}

// AB#audit-log, criterion 7: the audit details name the statuses and the note. No compensation values are included.
function transitionDetails(from: string, to: string, note: string | null): string {
  const text = `Status changed from ${from} to ${to}.`;
  return note === null ? text : `${text} Note: ${note}`;
}

// AB#status-workflow, criterion 2 and AB#hold-release, criteria 4 to 6: the status change and its audit entry
// are written in one transaction. Returns false when the status was no longer the expected one, so nothing is written.
function recordTransition(
  db: DatabaseSync,
  id: number,
  from: Status,
  request: ActionRequest,
  role: PortalRole,
): boolean {
  db.exec('BEGIN IMMEDIATE');
  try {
    let to: Status;
    const configuredTo = ACTION_RULES[request.action].to;
    if (configuredTo !== null) {
      to = configuredTo;
    } else {
      // AB#hold-release, criterion 5: resume goes back to the status the new hire had before the hold.
      const held = db.prepare('SELECT status_before_hold FROM new_hires WHERE id = ?').get(id);
      if (!held || held.status_before_hold === null) {
        throw new Error('The status before the hold is missing.');
      }
      to = String(held.status_before_hold) as Status;
    }

    const updated =
      request.action === 'hold'
        ? db
            .prepare(
              `UPDATE new_hires
               SET status = ?, hold_reason = ?, status_before_hold = ?,
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ? AND status = ?`,
            )
            .run(to, request.comment, from, id, from)
        : db
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

    if ((HISTORY_ACTIONS as readonly string[]).includes(request.action)) {
      db.prepare(
        `INSERT INTO new_hire_status_history (new_hire_id, from_status, to_status, action, role, comment)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, from, to, request.action, role, request.comment);
    }
    writeAudit(db, {
      entityType: 'new_hire',
      entityId: id,
      action: request.action,
      role,
      details: transitionDetails(from, to, request.comment),
    });
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
              n.hold_reason, r.number AS requisition_number,
              r.hiring_manager_name AS requisition_hiring_manager
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
    requisitionHiringManager:
      row.requisition_hiring_manager === null ? null : String(row.requisition_hiring_manager),
    holdReason: row.hold_reason === null ? null : String(row.hold_reason),
  };
  // AB#comp-view, criterion 3: the compensation field is added for hr_manager only, so it is absent otherwise.
  if (role === 'hr_manager') {
    record.compensation = readCompensation(db, id);
  }
  return record;
}

// AB#new-hire-edit, criterion 4: names and old and new values of the changed fields. Compensation is never part of an edit.
function editDetails(changes: { field: keyof NewHireInput; from: unknown; to: unknown }[]): string {
  if (changes.length === 0) {
    return 'No fields changed.';
  }
  return changes
    .map((change) => `${change.field} changed from ${JSON.stringify(change.from)} to ${JSON.stringify(change.to)}.`)
    .join(' ');
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
  // AB#audit-log, criterion 3: the new hire and its audit entry are saved in one transaction.
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
          jobTitle,
          department,
          input.startDate,
          input.requisitionId,
        );
      const id = Number(inserted.lastInsertRowid);
      writeAudit(db, {
        entityType: 'new_hire',
        entityId: id,
        action: 'create',
        role: roleOf(res),
        details: 'New hire created as draft.',
      });
      return id;
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

  // AB#new-hire-edit, criteria 2 to 4: a draft or returned new hire is corrected with the same rules as creating it.
  // Order of checks: unknown id (404), status not editable (409), missing expectedStatus (400),
  // stale expectedStatus (409), editable fields (400), requisition (400), then the save itself,
  // which is guarded by the expected status again.
  router.put('/:id', express.json(), (req, res) => {
    const id = idParam(req.params.id);
    const existing =
      id === null
        ? undefined
        : db
            .prepare(
              `SELECT first_name, last_name, personal_email, job_title, department, start_date,
                      status, requisition_id
               FROM new_hires WHERE id = ?`,
            )
            .get(id);
    if (id === null || !existing) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }

    const source = objectOf(req.body);
    const expectedStatus = source.expectedStatus;
    const expectedStatusValid = typeof expectedStatus === 'string' && expectedStatus.trim() !== '';
    const currentStatus = String(existing.status);

    // AB#new-hire-edit, criterion 3: a status that cannot be edited gets 409 with the current status,
    // before any field is validated, so nothing changes.
    if (!(EDITABLE_STATUSES as readonly string[]).includes(currentStatus)) {
      res.status(409).json({
        error: 'Only draft or returned new hires can be edited.',
        currentStatus,
      });
      return;
    }
    if (!expectedStatusValid) {
      res.status(400).json({ errors: { expectedStatus: 'Send the status the new hire currently has.' } });
      return;
    }
    // AB#new-hire-edit, criterion 3: a stale expectedStatus gets 409 with the current status, before fields are validated.
    if (expectedStatus !== currentStatus) {
      res.status(409).json({
        error: 'The new hire has changed since it was loaded. Reload to see its current status.',
        currentStatus,
      });
      return;
    }

    const result = validateNewHire(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }
    const { input } = result;
    const expected = expectedStatus as string;

    // AB#requisition-link, criteria 3 and 4 apply when the link changes; a kept link is not checked again for being unlinked.
    const previousRequisitionId = existing.requisition_id === null ? null : Number(existing.requisition_id);
    let jobTitle = input.jobTitle;
    let department = input.department;
    if (input.requisitionId !== null) {
      if (input.requisitionId !== previousRequisitionId) {
        const linkable = findLinkableRequisition(db, input.requisitionId);
        if ('error' in linkable) {
          res.status(400).json({ errors: { requisitionId: linkable.error } });
          return;
        }
        jobTitle = linkable.requisition.jobTitle;
        department = linkable.requisition.department;
      } else {
        const kept = db
          .prepare('SELECT job_title, department FROM requisitions WHERE id = ?')
          .get(input.requisitionId);
        if (kept) {
          jobTitle = String(kept.job_title);
          department = String(kept.department);
        }
      }
    }

    const next: NewHireInput = { ...input, jobTitle, department };
    const previous: NewHireInput = {
      firstName: String(existing.first_name),
      lastName: String(existing.last_name),
      personalEmail: String(existing.personal_email),
      jobTitle: String(existing.job_title),
      department: String(existing.department),
      startDate: String(existing.start_date),
      requisitionId: previousRequisitionId,
    };
    const changes = (Object.keys(next) as (keyof NewHireInput)[])
      .filter((field) => next[field] !== previous[field])
      .map((field) => ({ field, from: previous[field], to: next[field] }));

    const saved = inTransaction(db, () => {
      const updated = db
        .prepare(
          `UPDATE new_hires
           SET first_name = ?, last_name = ?, personal_email = ?, job_title = ?, department = ?,
               start_date = ?, requisition_id = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND status = ?`,
        )
        .run(
          next.firstName,
          next.lastName,
          next.personalEmail,
          next.jobTitle,
          next.department,
          next.startDate,
          next.requisitionId,
          id,
          expected,
        );
      if (Number(updated.changes) !== 1) {
        return false;
      }
      // AB#audit-log, criterion 6: the edit and its audit entry are saved together.
      writeAudit(db, {
        entityType: 'new_hire',
        entityId: id,
        action: 'edit',
        role: roleOf(res),
        details: editDetails(changes),
      });
      return true;
    });

    if (!saved) {
      // The status changed between the read above and the write, so nothing was written.
      const latest = readStatus(db, id) ?? currentStatus;
      res.status(409).json({
        error: 'The new hire has changed since it was loaded. Reload to see its current status.',
        currentStatus: latest,
      });
      return;
    }

    const updated = readDetail(db, id, roleOf(res));
    if (!updated) {
      throw new Error('Updated new hire could not be read back.');
    }
    res.status(200).json(updated);
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

  // AB#status-workflow, criteria 2 to 6, and AB#hold-release: submit, approve, return, hold, resume or release a new hire.
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

    // AB#status-workflow, criterion 4 and AB#hold-release, criterion 7: an action the role may never perform gets 403 and changes nothing.
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

    // AB#status-workflow, criterion 6: submit, approve and release list every reason they are blocked.
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
    const status = id === null ? null : readStatus(db, id);
    if (id === null || status === null) {
      res.status(404).json({ error: 'New hire not found.' });
      return;
    }

    // AB#hold-release, criterion 6: released is final, so compensation cannot change after release.
    // Checked before anything is validated, saved or audited.
    if (status === 'released') {
      res.status(409).json({
        error: 'A released new hire cannot be changed.',
        currentStatus: status,
      });
      return;
    }

    // AB#comp-validation, criterion 4: nothing is saved when any field is invalid.
    const result = validateCompensation(req.body);
    if ('errors' in result) {
      res.status(400).json({ errors: result.errors });
      return;
    }

    // AB#audit-log, criterion 7: the audit entry records only that compensation changed, never the amounts.
    inTransaction(db, () => {
      saveCompensation(db, id, result.input);
      writeAudit(db, {
        entityType: 'new_hire',
        entityId: id,
        action: 'compensation',
        role: roleOf(res),
        details: 'Compensation changed.',
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
