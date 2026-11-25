-- AB#status-workflow, criterion 1: one row per status change of a new hire.
-- Only a new table is created, so existing rows are not changed.
CREATE TABLE new_hire_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  new_hire_id INTEGER NOT NULL REFERENCES new_hires(id),
  from_status TEXT NOT NULL CHECK (from_status IN ('draft', 'in_review', 'returned', 'approved')),
  to_status TEXT NOT NULL CHECK (to_status IN ('draft', 'in_review', 'returned', 'approved')),
  action TEXT NOT NULL CHECK (action IN ('submit', 'approve', 'return')),
  role TEXT NOT NULL CHECK (role IN ('hr_coordinator', 'hr_manager')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX new_hire_status_history_new_hire_idx ON new_hire_status_history (new_hire_id, id);
