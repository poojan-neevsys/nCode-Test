import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;
  databasePath: string;
  clientDistPath: string;
}

const DEFAULT_PORT = '3000';
const DEFAULT_DATABASE_PATH = './data/hr-onboarding.db';

// Built client (client/dist). Same location whether running from src/ or dist/.
const clientDistPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Reads PORT and DATABASE_PATH from the environment; defaults match .env.example.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawPort = env.PORT?.trim() || DEFAULT_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value "${rawPort}": expected an integer from 1 to 65535.`);
  }

  return {
    port,
    databasePath: env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH,
    clientDistPath,
  };
}
