import { useEffect, useState } from 'react';

type HealthState =
  | { state: 'loading' }
  | { state: 'loaded'; status: string; database: string }
  | { state: 'failed' };

// AB#story, criterion 4: show the heading and the status from /api/health.
export function App() {
  const [health, setHealth] = useState<HealthState>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health')
      .then(async (response) => {
        // The server sends a JSON body with both 200 and 503 responses.
        const body = (await response.json()) as { status?: unknown; database?: unknown };
        if (!cancelled) {
          setHealth({
            state: 'loaded',
            status: String(body.status),
            database: String(body.database),
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth({ state: 'failed' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  let healthText = 'The health check could not be completed.';
  if (health.state === 'loading') {
    healthText = 'Checking system health...';
  } else if (health.state === 'loaded') {
    healthText = `Status: ${health.status}. Database: ${health.database}.`;
  }

  return (
    <main>
      <h1>NeevSys HR Onboarding Portal</h1>
      <section aria-labelledby="health-heading">
        <h2 id="health-heading">System health</h2>
        <p role="status">{healthText}</p>
      </section>
    </main>
  );
}
