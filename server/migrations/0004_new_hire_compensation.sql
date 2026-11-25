-- AB#comp-storage, criterion 1: compensation is stored apart from the new_hires record.
-- The primary key on new_hire_id allows at most one compensation record per new hire.
-- Only a new table is created, so existing rows are not changed.
CREATE TABLE new_hire_compensation (
  new_hire_id INTEGER PRIMARY KEY REFERENCES new_hires(id),
  base_salary INTEGER NOT NULL CHECK (base_salary BETWEEN 1 AND 10000000),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  bonus_target_percent REAL CHECK (bonus_target_percent IS NULL OR bonus_target_percent BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
