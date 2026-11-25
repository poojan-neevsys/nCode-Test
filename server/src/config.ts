import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compiled file lives in server/dist, so the server root is one level up.
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface AppConfig {
  port: number;
  databaseFile: string;
  migrationsDir: string;
  clientDistDir: string;
}

function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT?.trim() || '3000'),
    databaseFile: resolve(env.DATABASE_FILE?.trim() || './data/hr-onboarding.db'),
    migrationsDir: join(serverRoot, 'migrations'),
    clientDistDir: resolve(serverRoot, '..', 'client', 'dist'),
  };
}
