-- AB#requisition-link, criterion 1: requisitions table. Requisitions come from the
-- ATS later (EP-03); until then they live here. Numbers look like REQ-YYYY-NNN and are unique.
CREATE TABLE requisitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE CHECK (number GLOB 'REQ-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]'),
  job_title TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('Engineering', 'Finance', 'HR', 'Operations', 'Sales')),
  hiring_manager_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'filled', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- AB#requisition-link, criterion 1: optional link from a new hire to a requisition.
-- Existing rows keep NULL, so they stay valid.
ALTER TABLE new_hires ADD COLUMN requisition_id INTEGER REFERENCES requisitions(id);

-- AB#requisition-link, criterion 3: a requisition can be linked to one new hire only.
-- NULL values do not conflict, so unlinked new hires are not affected.
CREATE UNIQUE INDEX new_hires_requisition_id_unique ON new_hires (requisition_id);

-- Seed data: every status and every department is covered.
INSERT INTO requisitions (number, job_title, department, hiring_manager_name, status) VALUES
  ('REQ-2026-001', 'Software Engineer', 'Engineering', 'Priya Nair', 'open'),
  ('REQ-2026-002', 'Financial Analyst', 'Finance', 'Mark Dsouza', 'open'),
  ('REQ-2026-003', 'HR Business Partner', 'HR', 'Anita Rao', 'filled'),
  ('REQ-2026-004', 'Operations Manager', 'Operations', 'Suresh Iyer', 'open'),
  ('REQ-2026-005', 'Sales Executive', 'Sales', 'Kavya Menon', 'open'),
  ('REQ-2026-006', 'Senior Software Engineer', 'Engineering', 'Priya Nair', 'filled'),
  ('REQ-2026-007', 'Payroll Accountant', 'Finance', 'Mark Dsouza', 'cancelled'),
  ('REQ-2026-008', 'Sales Development Representative', 'Sales', 'Kavya Menon', 'cancelled'),
  ('REQ-2026-009', 'Recruiter', 'HR', 'Anita Rao', 'open');
