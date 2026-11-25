import { useEffect, useState, type ReactNode } from 'react';
import { apiFetch, readStoredRole, storeRole, type PortalRole } from './api';
import { NewHireDetailPage } from './NewHireDetail';
import { NewHireFormPage } from './NewHireForm';
import { NewHireListPage } from './NewHireList';
import { RoleSwitcher } from './RoleSwitcher';
import { currentPath, Link } from './navigation';

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
    const response = await apiFetch('/api/health', { signal });
    const body: unknown = await response.json();
    if (isHealth(body)) {
      return body;
    }
  } catch {
    // Fall through to the "unreachable" state below.
  }
  return { status: 'unreachable', database: 'unknown' };
}

function HomePage() {
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
      <p>
        <Link to="/new-hires">New hires</Link>
      </p>
    </main>
  );
}

export function App() {
  // AB#new-hire-draft: a small path switch; the pages are few, so no router package is needed.
  const [path, setPath] = useState(currentPath);
  // AB#new-hire-compensation, criterion 7: the development role, remembered in storage.
  const [role, setRole] = useState<PortalRole>(readStoredRole);

  useEffect(() => {
    const onLocationChange = () => setPath(currentPath());
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('locationchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('locationchange', onLocationChange);
    };
  }, []);

  function changeRole(next: PortalRole) {
    storeRole(next);
    setRole(next);
  }

  let page: ReactNode;
  const detailMatch = /^\/new-hires\/(\d+)$/.exec(path);
  if (path === '/new-hires') {
    page = <NewHireListPage />;
  } else if (path === '/new-hires/new') {
    page = <NewHireFormPage />;
  } else if (detailMatch) {
    page = <NewHireDetailPage id={Number(detailMatch[1])} role={role} />;
  } else {
    page = <HomePage />;
  }

  return (
    <>
      <RoleSwitcher role={role} onChange={changeRole} />
      {page}
    </>
  );
}
