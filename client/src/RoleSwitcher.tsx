import type { PortalRole } from './api';

interface RoleSwitcherProps {
  role: PortalRole;
  onChange: (role: PortalRole) => void;
}

// AB#new-hire-compensation, criterion 7: development-only switcher for the acting role
// until real sign-in arrives with EP-04 (SSO).
export function RoleSwitcher({ role, onChange }: RoleSwitcherProps) {
  return (
    <header>
      <label htmlFor="dev-role">Development only: acting role</label>{' '}
      <select
        id="dev-role"
        value={role}
        onChange={(event) =>
          onChange(event.target.value === 'hr_manager' ? 'hr_manager' : 'hr_coordinator')
        }
      >
        <option value="hr_coordinator">HR coordinator</option>
        <option value="hr_manager">HR manager</option>
      </select>
    </header>
  );
}
