-- AB#audit-log, criterion 1: append-only audit trail of changes to new hires.
-- Only a new table is created, so existing rows are not changed.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('new_hire')),
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('hr_coordinator', 'hr_manager')),
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, id);

-- AB#audit-log, criterion 8: entries are only ever added. The database rejects any change or removal.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log entries cannot be changed');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log entries cannot be removed');
END;
