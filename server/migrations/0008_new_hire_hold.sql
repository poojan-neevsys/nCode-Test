-- AB#hold-release, criteria 4 and 5: the hold reason and the status to return to on resume.
-- ADD COLUMN keeps existing rows; they stay NULL, which is correct for records that were never held.
ALTER TABLE new_hires ADD COLUMN hold_reason TEXT;
ALTER TABLE new_hires ADD COLUMN status_before_hold TEXT;
