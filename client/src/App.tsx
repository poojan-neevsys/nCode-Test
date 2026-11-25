import { useEffect, useState } from 'react';

interface Health {
  status: string;
  database: string;
}

function isHealth(value: unknown): value is Health {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.status === 'string' && typeof candidate.database === 'string';
}

// AB#foundation, criterion 4: show the status returned by /api/health.
// A 503 response still carries the JSON body, so it is read like a normal reply.
async function loadHealth(signal: AbortSignal): Promise<Health> {
  try {
    const response = await fetch('/api/health', { signal });
    const body: unknown = await response.json();
    if (isHealth(body)) {
      return body;
    }
  } catch {
    // Fall through to the "unreachable" state below.
  }
  return { status: 'unreachable', database: 'unknown' };
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadHealth(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setHealth(result);
      }
    });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>NeevSys HR Onboarding Portal</h1>
      <p role="status" aria-live="polite">
        {health === null
          ? 'Checking service health...'
          : `Server status: ${health.status}. Database: ${health.database}.`}
      </p>
    </main>
  );
}
