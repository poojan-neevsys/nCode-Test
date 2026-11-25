-- AB#hold-release, criteria 2 and 5: a hold keeps its reason and the status the new hire returns to on resume.
-- Only new columns are added, so existing rows keep NULL.
ALTER TABLE new_hires ADD COLUMN hold_reason TEXT;
ALTER TABLE new_hires ADD COLUMN status_before_hold TEXT
  CHECK (status_before_hold IS NULL OR status_before_hold IN ('in_review', 'approved'));
