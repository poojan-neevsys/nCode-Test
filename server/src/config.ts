import fs from 'node:fs';
import path from 'node:path';

// This file compiles to server/dist/config.js, so one level up is the server package root.
const serverRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(serverRoot, '..');

// Optional local overrides from <repo>/.env. Variables already set in the environment win.
const envFile = path.join(repoRoot, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export interface AppConfig {
  port: number;
  databaseFile: string;
  migrationsDir: string;
  clientDir: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_FILE = './data/hr-onboarding.db';

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid PORT value "${raw}": expected an integer from 1 to 65535.`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawDatabaseFile = env.DATABASE_FILE;
  const databaseFile =
    rawDatabaseFile === undefined || rawDatabaseFile.trim() === ''
      ? DEFAULT_DATABASE_FILE
      : rawDatabaseFile;

  return {
    port: parsePort(env.PORT),
    databaseFile: path.resolve(serverRoot, databaseFile),
    migrationsDir: path.join(serverRoot, 'migrations'),
    clientDir: path.join(repoRoot, 'client', 'dist'),
  };
}
