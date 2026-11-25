import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase, runMigrations } from './db.js';

const config = loadConfig();

const db = openDatabase(config.databaseFile);
const applied = runMigrations(db, config.migrationsDir);
console.log(
  applied.length > 0
    ? `Applied migrations: ${applied.join(', ')}`
    : 'No pending migrations.',
);

const app = createApp(db, config.clientDistDir);
app.listen(config.port, () => {
  console.log(`HR Onboarding Portal listening on http://localhost:${config.port}`);
});
