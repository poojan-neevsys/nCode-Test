import type { PortalRole } from './role';

const OPTIONS: { value: PortalRole; label: string }[] = [
  { value: 'hr_coordinator', label: 'HR coordinator' },
  { value: 'hr_manager', label: 'HR manager' },
];

interface RoleSwitcherProps {
  role: PortalRole;
  onChange: (role: PortalRole) => void;
}

// AB#comp-role-switch, criterion 6: labelled as development only. Native radio buttons keep it keyboard friendly.
export function RoleSwitcher({ role, onChange }: RoleSwitcherProps) {
  return (
    <fieldset className="role-switcher">
      <legend>Acting role (development only)</legend>
      {OPTIONS.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name="portal-role"
            value={option.value}
            checked={role === option.value}
            onChange={() => onChange(option.value)}
          />{' '}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
