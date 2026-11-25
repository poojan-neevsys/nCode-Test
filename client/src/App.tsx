import { useEffect, useState } from 'react';

interface HealthBody {
  status?: string;
  database?: string;
}

// Reads /api/health. Any network or parse failure is shown as "unavailable" without internal details.
async function loadHealthMessage(): Promise<string> {
  try {
    const response = await fetch('/api/health');
    const body = (await response.json()) as HealthBody;
    return `Server status: ${body.status ?? 'unknown'}. Database: ${body.database ?? 'unknown'}.`;
  } catch {
    return 'Server status: unavailable.';
  }
}

export function App() {
  const [healthMessage, setHealthMessage] = useState('Checking server status...');

  useEffect(() => {
    let active = true;
    loadHealthMessage().then((message) => {
      if (active) {
        setHealthMessage(message);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <h1>NeevSys HR Onboarding Portal</h1>
      <p role="status">{healthMessage}</p>
    </main>
  );
}
