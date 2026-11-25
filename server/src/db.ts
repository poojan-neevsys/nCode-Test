import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

// Returns true when the database answers a trivial query. Errors are not
// rethrown so the health endpoint can report "error" without internal details.
export function checkDatabase(db: DatabaseSync): boolean {
  try {
    db.prepare('SELECT 1 AS ok').get();
    return true;
  } catch {
    return false;
  }
}

// AB#audit-log, criterion 3: runs the work in one IMMEDIATE transaction. It is committed when the work
// returns and rolled back when it throws.
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// AB#foundation, criterion 3: apply pending *.sql files in name order, record
// each one in schema_migrations, and apply nothing on later runs.
// Returns the names of the migrations applied in this run.
export function runMigrations(db: DatabaseSync, migrationsDir: string): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const alreadyApplied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => String(row.name)),
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    if (alreadyApplied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${file} failed: ${reason}`);
    }
    applied.push(file);
  }
  return applied;
}
