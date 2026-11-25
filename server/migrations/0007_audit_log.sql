-- AB#edit-hold-release, criterion 1: audit log. One row per saved create, edit, action or compensation change.
-- Only a new table and triggers are added, so existing rows are not changed.
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

-- AB#edit-hold-release, criterion 9: entries are only ever added. These triggers refuse any change or removal.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log entries cannot be changed.');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'Audit log entries cannot be deleted.');
END;
