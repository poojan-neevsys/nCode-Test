import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Plain SQL migration files live in server/migrations (same path from src/ and dist/).
const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

// AB#story, criterion 3: apply pending *.sql files in name order and record each one
// in schema_migrations. Files already recorded are skipped, so a second run applies nothing.
export function runMigrations(db: DatabaseSync, dir: string = migrationsDir): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[];
  const applied = new Set(appliedRows.map((row) => row.name));
  const insertRecord = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      insertRecord.run(file, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${reason}`);
    }
    newlyApplied.push(file);
  }
  return newlyApplied;
}

// AB#story, criterion 2: a database check that never throws, used by /api/health.
export function isDatabaseHealthy(db: DatabaseSync): boolean {
  try {
    db.prepare('SELECT 1 AS ok').get();
    return true;
  } catch {
    return false;
  }
}
