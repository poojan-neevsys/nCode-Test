-- AB#edit-hold-release, criteria 4 to 6: the on_hold and released statuses and the hold, resume and release
-- actions must be accepted by the status history table. SQLite cannot change a CHECK constraint, so the
-- table is rebuilt and every existing row is copied unchanged.
-- new_hires.status has no CHECK constraint (0002_new_hires.sql declares it as TEXT NOT NULL DEFAULT 'draft'),
-- so new_hires needs no rebuild for on_hold or released. The allowed values are enforced by STATUSES in
-- server/src/new-hires.ts. new_hires is the parent of new_hire_compensation and the status history, so it
-- is left as it is.
CREATE TABLE new_hire_status_history_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  new_hire_id INTEGER NOT NULL REFERENCES new_hires(id),
  from_status TEXT NOT NULL CHECK (from_status IN ('draft', 'in_review', 'returned', 'approved', 'on_hold', 'released')),
  to_status TEXT NOT NULL CHECK (to_status IN ('draft', 'in_review', 'returned', 'approved', 'on_hold', 'released')),
  action TEXT NOT NULL CHECK (action IN ('submit', 'approve', 'return', 'hold', 'resume', 'release')),
  role TEXT NOT NULL CHECK (role IN ('hr_coordinator', 'hr_manager')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO new_hire_status_history_next (id, new_hire_id, from_status, to_status, action, role, comment, created_at)
  SELECT id, new_hire_id, from_status, to_status, action, role, comment, created_at
  FROM new_hire_status_history;

DROP TABLE new_hire_status_history;

ALTER TABLE new_hire_status_history_next RENAME TO new_hire_status_history;

CREATE INDEX new_hire_status_history_new_hire_idx ON new_hire_status_history (new_hire_id, id);

-- AB#edit-hold-release, criteria 4 and 5: the hold reason is kept on the record while it is on hold, and the
-- status to return to on resume is stored when the hold starts. Existing rows keep NULL.
ALTER TABLE new_hires ADD COLUMN hold_reason TEXT;
ALTER TABLE new_hires ADD COLUMN status_before_hold TEXT
  CHECK (status_before_hold IS NULL OR status_before_hold IN ('in_review', 'approved'));
