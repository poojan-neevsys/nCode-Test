import { useEffect, useState, type ReactElement } from 'react';
import { NewHireDetailPage } from './NewHireDetail';
import { NewHireFormPage } from './NewHireForm';
import { NewHireListPage } from './NewHireList';
import { currentPath, Link } from './navigation';
import { getPortalRole, portalHeaders, setPortalRole, type PortalRole } from './role';
import { RoleSwitcher } from './RoleSwitcher';
import { TemplatesPage } from './Templates';

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
    const response = await fetch('/api/health', { signal, headers: portalHeaders() });
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
      <p>
        <Link to="/templates">Letter templates</Link>
      </p>
    </main>
  );
}

// AB#new-hire-draft: the detail page path, /new-hires/<id>.
const DETAIL_PATH = /^\/new-hires\/(\d+)$/;

// AB#edit-hold-release, criterion 10: the edit page path, /new-hires/<id>/edit.
const EDIT_PATH = /^\/new-hires\/(\d+)\/edit$/;

export function App() {
  // AB#new-hire-draft: a small path switch; the pages are few, so no router package is needed.
  const [path, setPath] = useState(currentPath);
  // AB#comp-role-switch, criterion 6: the development role is kept in storage and sent on every request.
  const [role, setRole] = useState<PortalRole>(getPortalRole);

  function changeRole(next: PortalRole) {
    setPortalRole(next);
    setRole(next);
  }

  useEffect(() => {
    const onLocationChange = () => setPath(currentPath());
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('locationchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('locationchange', onLocationChange);
    };
  }, []);

  let page: ReactElement;
  const detailMatch = DETAIL_PATH.exec(path);
  const editMatch = EDIT_PATH.exec(path);
  if (path === '/new-hires') {
    page = <NewHireListPage />;
  } else if (path === '/new-hires/new') {
    page = <NewHireFormPage />;
  } else if (path === '/templates') {
    // AB#letter-templates, criterion 8: the templates page; the role decides who may edit.
    page = <TemplatesPage role={role} />;
  } else if (editMatch) {
    // AB#edit-hold-release, criterion 10: the edit form for a draft or returned new hire.
    page = <NewHireFormPage key={editMatch[1]} id={Number(editMatch[1])} />;
  } else if (detailMatch) {
    page = <NewHireDetailPage key={detailMatch[1]} id={Number(detailMatch[1])} role={role} />;
  } else {
    page = <HomePage />;
  }

  return (
    <>
      <header className="app-header">
        <RoleSwitcher role={role} onChange={changeRole} />
      </header>
      {page}
    </>
  );
}
