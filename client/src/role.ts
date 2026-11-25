// AB#comp-role-switch, criterion 6: development-only stand-in for sign-in (EP-04).
// The chosen role is kept in localStorage and sent with every API request in X-Portal-Role.
export type PortalRole = 'hr_coordinator' | 'hr_manager';

const STORAGE_KEY = 'hr-portal-dev-role';
const DEFAULT_ROLE: PortalRole = 'hr_coordinator';

function isPortalRole(value: unknown): value is PortalRole {
  return value === 'hr_coordinator' || value === 'hr_manager';
}

function readStoredRole(): PortalRole {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isPortalRole(stored)) {
      return stored;
    }
  } catch {
    // Storage can be blocked; fall back to the default role.
  }
  return DEFAULT_ROLE;
}

let activeRole: PortalRole = readStoredRole();

export function getPortalRole(): PortalRole {
  return activeRole;
}

export function setPortalRole(role: PortalRole): void {
  activeRole = role;
  try {
    window.localStorage.setItem(STORAGE_KEY, role);
  } catch {
    // The role still applies for this page view when storage is blocked.
  }
}

// Header to add to every API request.
export function portalHeaders(): Record<string, string> {
  return { 'X-Portal-Role': activeRole };
}
