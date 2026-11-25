import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase, runMigrations } from './db.js';

function main(): void {
  const config = loadConfig();

  const db = openDatabase(config.databasePath);
  const applied = runMigrations(db);
  console.log(
    applied.length > 0
      ? `Applied migrations: ${applied.join(', ')}`
      : 'No pending migrations.',
  );

  const app = createApp(db, config.clientDistPath);
  app.listen(config.port, () => {
    console.log(`HR Onboarding Portal listening on port ${config.port}`);
  });
}

try {
  main();
} catch (error) {
  console.error('Server failed to start:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
