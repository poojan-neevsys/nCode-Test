-- AB#new-hire-compensation, criterion 1: compensation kept apart from the new_hires table.
-- new_hire_id is the primary key, so each new hire has at most one compensation record.
-- Existing rows are not changed.
CREATE TABLE new_hire_compensation (
  new_hire_id INTEGER PRIMARY KEY REFERENCES new_hires (id) ON DELETE CASCADE,
  base_salary INTEGER NOT NULL CHECK (base_salary BETWEEN 1 AND 10000000),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'INR')),
  bonus_target_percent REAL CHECK (
    bonus_target_percent IS NULL OR (bonus_target_percent >= 0 AND bonus_target_percent <= 100)
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
