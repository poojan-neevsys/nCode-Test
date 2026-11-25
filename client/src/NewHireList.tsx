import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, navigateTo } from './navigation';
import { portalHeaders } from './role';

interface NewHire {
  id: number;
  fullName: string;
  jobTitle: string;
  department: string;
  startDate: string;
  status: string;
  requisitionNumber: string | null;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; items: NewHire[] };

function isNewHire(value: unknown): value is NewHire {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.fullName === 'string' &&
    typeof candidate.jobTitle === 'string' &&
    typeof candidate.department === 'string' &&
    typeof candidate.startDate === 'string' &&
    typeof candidate.status === 'string' &&
    (candidate.requisitionNumber === null || typeof candidate.requisitionNumber === 'string')
  );
}

async function loadNewHires(signal: AbortSignal): Promise<ListState> {
  try {
    const response = await fetch('/api/new-hires', { signal, headers: portalHeaders() });
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (Array.isArray(body) && body.every(isNewHire)) {
      return { kind: 'ready', items: body };
    }
  } catch {
    // Fall through to the failed state below.
  }
  return { kind: 'failed' };
}

// Statuses are stored in lower case; show them with a capital first letter and spaces for underscores.
export function statusLabel(status: string): string {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// AB#status-workflow, criterion 10: the statuses offered by the list filter.
// AB#hold-release: on_hold and released are offered too.
const STATUS_FILTERS = ['draft', 'in_review', 'returned', 'approved', 'on_hold', 'released'] as const;

// The filter is kept in the address bar as ?status=. An unknown value means no filter.
function readStatusFilter(): string {
  const value = new URLSearchParams(window.location.search).get('status') ?? '';
  return (STATUS_FILTERS as readonly string[]).includes(value) ? value : '';
}

export function NewHireListPage() {
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [statusFilter, setStatusFilter] = useState(readStatusFilter);

  useEffect(() => {
    const controller = new AbortController();
    loadNewHires(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setState(result);
      }
    });
    return () => controller.abort();
  }, []);

  // navigateTo and the browser's back and forward buttons both change the filter this way.
  useEffect(() => {
    const onLocationChange = () => setStatusFilter(readStatusFilter());
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('locationchange', onLocationChange);
    return () => {
      window.removeEventListener('popstate', onLocationChange);
      window.removeEventListener('locationchange', onLocationChange);
    };
  }, []);

  function chooseStatus(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    navigateTo(value === '' ? '/new-hires' : `/new-hires?status=${encodeURIComponent(value)}`);
  }

  const visibleItems =
    state.kind === 'ready'
      ? state.items.filter((item) => statusFilter === '' || item.status === statusFilter)
      : [];

  return (
    <main>
      <h1>New hires</h1>
      <p>
        <Link to="/new-hires/new">Add new hire</Link>
      </p>
      {state.kind === 'loading' && <p role="status">Loading new hires...</p>}
      {state.kind === 'failed' && <p role="alert">Could not load new hires. Try again later.</p>}
      {state.kind === 'ready' && state.items.length === 0 && <p>No new hires yet.</p>}
      {state.kind === 'ready' && state.items.length > 0 && (
        <>
          <p>
            <label htmlFor="status-filter">Status</label>{' '}
            <select id="status-filter" name="status" value={statusFilter} onChange={chooseStatus}>
              <option value="">All statuses</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </p>
          {visibleItems.length === 0 ? (
            <p>{`No new hires with status ${statusLabel(statusFilter)}.`}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Job title</th>
                  <th scope="col">Department</th>
                  <th scope="col">Requisition</th>
                  <th scope="col">Start date</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {/* AB#comp-view, criterion 6: selecting a row opens its detail page. */}
                      <Link to={`/new-hires/${item.id}`}>{item.fullName}</Link>
                    </td>
                    <td>{item.jobTitle}</td>
                    <td>{item.department}</td>
                    <td>{item.requisitionNumber ?? '-'}</td>
                    <td>{item.startDate}</td>
                    <td>{statusLabel(item.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </main>
  );
}
