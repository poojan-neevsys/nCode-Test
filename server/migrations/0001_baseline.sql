-- Baseline migration for the HR Onboarding Portal foundation.
-- Creates no application tables yet. EP-01 stories add their own numbered
-- migration files here; each file runs once, in name order, inside a transaction.
-- Do not put BEGIN/COMMIT in migration files; the runner manages the transaction.
SELECT 1;
