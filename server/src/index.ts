import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { runMigrations } from './migrate';
import fs from 'node:fs';
import path from 'node:path';

const config = loadConfig();
const db = openDatabase(config.databaseFile);

const applied = runMigrations(db, config.migrationsDir);
if (applied.length > 0) {
  console.log(`Applied migrations: ${applied.join(', ')}`);
}

if (!fs.existsSync(path.join(config.clientDir, 'index.html'))) {
  console.warn('Client build not found. Run "npm run build" to serve the portal UI.');
}

const app = createApp(db, config.clientDir);
app.listen(config.port, () => {
  console.log(`HR Onboarding Portal listening on http://localhost:${config.port}`);
});
