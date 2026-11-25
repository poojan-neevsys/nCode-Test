-- AB#new-hire-draft, criterion 1: new_hires table. Every record starts as 'draft'.
-- There is no created-by column yet because authentication arrives in EP-04.
CREATE TABLE new_hires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  personal_email TEXT NOT NULL,
  job_title TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('Engineering', 'Finance', 'HR', 'Operations', 'Sales')),
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
