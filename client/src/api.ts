export type PortalRole = 'hr_coordinator' | 'hr_manager';

const ROLE_STORAGE_KEY = 'portal-role';

// AB#new-hire-compensation, criterion 7: the development role is remembered across reloads.
// Anything missing or unknown is treated as hr_coordinator, as the server does.
export function readStoredRole(): PortalRole {
  try {
    return window.localStorage.getItem(ROLE_STORAGE_KEY) === 'hr_manager'
      ? 'hr_manager'
      : 'hr_coordinator';
  } catch {
    // Storage can be blocked; the default role is used then.
    return 'hr_coordinator';
  }
}

export function storeRole(role: PortalRole): void {
  try {
    window.localStorage.setItem(ROLE_STORAGE_KEY, role);
  } catch {
    // The choice still applies for this page view when storage is blocked.
  }
}

// AB#new-hire-compensation, criterion 7: every API request carries the acting role.
export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Portal-Role', readStoredRole());
  return fetch(input, { ...init, headers });
}
