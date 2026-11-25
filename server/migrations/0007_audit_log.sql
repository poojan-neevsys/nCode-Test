-- AB#audit-log, criterion 1: one row per successful change to a new hire (create, edit, action, compensation).
-- Only a new table is created, so existing rows are not changed.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('hr_coordinator', 'hr_manager')),
  details TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, id);

-- AB#audit-log, criterion 7: entries are only ever added. These triggers reject any change or removal,
-- so no endpoint or later statement can alter the audit trail.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log entries cannot be changed.');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log entries cannot be deleted.');
END;
