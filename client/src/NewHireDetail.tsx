import { useEffect, useState, type FormEvent } from 'react';
import { readErrors } from './NewHireForm';
import { statusLabel } from './NewHireList';
import { Link } from './navigation';
import { portalHeaders, type PortalRole } from './role';

// AB#comp-view and AB#comp-set: shape of compensation returned to hr_manager.
export interface Compensation {
  baseSalary: number;
  currency: string;
  bonusTargetPercent: number | null;
  updatedAt: string;
}

interface NewHireDetailRecord {
  id: number;
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
  status: string;
  requisitionNumber: string | null;
  // Present only when the server answered for hr_manager.
  compensation?: Compensation | null;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'notFound' }
  | { kind: 'ready'; record: NewHireDetailRecord };

function isCompensation(value: unknown): value is Compensation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.baseSalary === 'number' &&
    typeof candidate.currency === 'string' &&
    (candidate.bonusTargetPercent === null || typeof candidate.bonusTargetPercent === 'number') &&
    typeof candidate.updatedAt === 'string'
  );
}

function isNewHireDetail(value: unknown): value is NewHireDetailRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.firstName === 'string' &&
    typeof candidate.lastName === 'string' &&
    typeof candidate.personalEmail === 'string' &&
    typeof candidate.jobTitle === 'string' &&
    typeof candidate.department === 'string' &&
    typeof candidate.startDate === 'string' &&
    typeof candidate.status === 'string' &&
    (candidate.requisitionNumber === null || typeof candidate.requisitionNumber === 'string') &&
    (candidate.compensation === undefined ||
      candidate.compensation === null ||
      isCompensation(candidate.compensation))
  );
}

async function loadNewHire(id: number, signal: AbortSignal): Promise<LoadState> {
  try {
    const response = await fetch(`/api/new-hires/${id}`, { signal, headers: portalHeaders() });
    if (response.status === 404) {
      return { kind: 'notFound' };
    }
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (isNewHireDetail(body)) {
      return { kind: 'ready', record: body };
    }
  } catch {
    // Aborted or unreachable: fall through to the failed state below.
  }
  return { kind: 'failed' };
}

// AB#comp-view, criterion 7: the detail page. The compensation section is only rendered for hr_manager.
export function NewHireDetailPage({ id, role }: { id: number; role: PortalRole }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    loadNewHire(id, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setState(result);
      }
    });
    return () => controller.abort();
    // Reload when the role changes so the server returns the fields that role may see.
  }, [id, role]);

  return (
    <main>
      <h1>New hire details</h1>
      {state.kind === 'loading' && <p role="status">Loading new hire...</p>}
      {state.kind === 'failed' && (
        <p role="alert">Could not load this new hire. Try again later.</p>
      )}
      {state.kind === 'notFound' && <p role="alert">New hire not found.</p>}
      {state.kind === 'ready' && (
        <>
          <dl>
            <dt>Name</dt>
            <dd>{`${state.record.firstName} ${state.record.lastName}`}</dd>
            <dt>Personal email</dt>
            <dd>{state.record.personalEmail}</dd>
            <dt>Job title</dt>
            <dd>{state.record.jobTitle}</dd>
            <dt>Department</dt>
            <dd>{state.record.department}</dd>
            <dt>Requisition</dt>
            <dd>{state.record.requisitionNumber ?? '-'}</dd>
            <dt>Start date</dt>
            <dd>{state.record.startDate}</dd>
            <dt>Status</dt>
            <dd>{statusLabel(state.record.status)}</dd>
          </dl>
          {role === 'hr_manager' && (
            <CompensationSection
              key={state.record.id}
              newHireId={state.record.id}
              initial={state.record.compensation ?? null}
            />
          )}
        </>
      )}
      <p>
        <Link to="/new-hires">Back to new hires</Link>
      </p>
    </main>
  );
}

type CompensationFieldName = 'baseSalary' | 'currency' | 'bonusTargetPercent';
type CompensationFieldErrors = Partial<Record<CompensationFieldName, string>>;

// Must match the field names the server returns in its 400 responses.
const COMPENSATION_FIELD_ORDER: readonly CompensationFieldName[] = [
  'baseSalary',
  'currency',
  'bonusTargetPercent',
];
const CURRENCIES = ['USD', 'INR'];

interface CompensationValues {
  baseSalary: string;
  currency: string;
  bonusTargetPercent: string;
}

function valuesFrom(compensation: Compensation | null): CompensationValues {
  return {
    baseSalary: compensation ? String(compensation.baseSalary) : '',
    currency: compensation ? compensation.currency : '',
    bonusTargetPercent:
      compensation && compensation.bonusTargetPercent !== null
        ? String(compensation.bonusTargetPercent)
        : '',
  };
}

function isCompensationFieldName(value: string): value is CompensationFieldName {
  return (COMPENSATION_FIELD_ORDER as readonly string[]).includes(value);
}

// AB#comp-set, criteria 4 and 5: HR manager view and edit form. Errors are tied to fields and focus moves to the first one.
function CompensationSection({
  newHireId,
  initial,
}: {
  newHireId: number;
  initial: Compensation | null;
}) {
  const [saved, setSaved] = useState<Compensation | null>(initial);
  const [values, setValues] = useState<CompensationValues>(() => valuesFrom(initial));
  const [fieldErrors, setFieldErrors] = useState<CompensationFieldErrors>({});
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  function updateValue(field: CompensationFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError('');
    setMessage('');

    const salary = values.baseSalary.trim();
    const bonus = values.bonusTargetPercent.trim();
    let response: Response;
    try {
      response = await fetch(`/api/new-hires/${newHireId}/compensation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify({
          baseSalary: salary === '' ? null : Number(salary),
          currency: values.currency === '' ? null : values.currency,
          bonusTargetPercent: bonus === '' ? null : Number(bonus),
        }),
      });
    } catch {
      setFormError('Could not reach the server. Your entries are kept; try again.');
      setSaving(false);
      return;
    }

    if (response.status === 200) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // A body that is not JSON leaves the generic message below.
      }
      if (isCompensation(body)) {
        setSaved(body);
        setValues(valuesFrom(body));
        setMessage('Compensation saved.');
      } else {
        setFormError('Could not save the compensation. Try again.');
      }
    } else if (response.status === 400) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // A body that is not JSON leaves the generic message below.
      }
      const serverErrors = readErrors(body);
      const known: CompensationFieldErrors = {};
      for (const [key, errorMessage] of Object.entries(serverErrors)) {
        if (isCompensationFieldName(key)) {
          known[key] = errorMessage;
        }
      }
      const firstInvalid = COMPENSATION_FIELD_ORDER.find((field) => known[field] !== undefined);
      setFieldErrors(known);
      setFormError(
        firstInvalid === undefined
          ? 'Could not save the compensation. Check the form and try again.'
          : 'Please correct the fields marked below.',
      );
      if (firstInvalid !== undefined) {
        document.getElementById(`comp-${firstInvalid}`)?.focus();
      }
    } else if (response.status === 403) {
      setFormError('Only HR managers can change compensation.');
    } else {
      setFormError('Could not save the compensation. Your entries are kept; try again.');
    }
    setSaving(false);
  }

  function describedBy(field: CompensationFieldName): string | undefined {
    return fieldErrors[field] ? `comp-error-${field}` : undefined;
  }

  function renderError(field: CompensationFieldName) {
    const errorMessage = fieldErrors[field];
    return errorMessage ? (
      <span id={`comp-error-${field}`} className="field-error">
        {errorMessage}
      </span>
    ) : null;
  }

  return (
    <section aria-labelledby="compensation-heading">
      <h2 id="compensation-heading">Compensation</h2>
      {saved === null ? (
        <p>No compensation recorded yet.</p>
      ) : (
        <dl>
          <dt>Base salary</dt>
          <dd>{`${saved.baseSalary} ${saved.currency}`}</dd>
          <dt>Bonus target</dt>
          <dd>{saved.bonusTargetPercent === null ? 'None' : `${saved.bonusTargetPercent}%`}</dd>
        </dl>
      )}
      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <p>
          <label htmlFor="comp-baseSalary">Base salary (whole number, 1 to 10000000)</label>{' '}
          <input
            id="comp-baseSalary"
            name="baseSalary"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000000}
            step={1}
            value={values.baseSalary}
            onChange={(event) => updateValue('baseSalary', event.target.value)}
            aria-invalid={fieldErrors.baseSalary ? true : undefined}
            aria-describedby={describedBy('baseSalary')}
          />
          {renderError('baseSalary')}
        </p>
        <p>
          <label htmlFor="comp-currency">Currency</label>{' '}
          <select
            id="comp-currency"
            name="currency"
            value={values.currency}
            onChange={(event) => updateValue('currency', event.target.value)}
            aria-invalid={fieldErrors.currency ? true : undefined}
            aria-describedby={describedBy('currency')}
          >
            <option value="">Select a currency</option>
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
          {renderError('currency')}
        </p>
        <p>
          <label htmlFor="comp-bonusTargetPercent">Bonus target percent (optional, 0 to 100)</label>{' '}
          <input
            id="comp-bonusTargetPercent"
            name="bonusTargetPercent"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={values.bonusTargetPercent}
            onChange={(event) => updateValue('bonusTargetPercent', event.target.value)}
            aria-invalid={fieldErrors.bonusTargetPercent ? true : undefined}
            aria-describedby={describedBy('bonusTargetPercent')}
          />
          {renderError('bonusTargetPercent')}
        </p>
        <p>
          <button type="submit" disabled={saving}>
            Save compensation
          </button>
        </p>
        <p role="status">{saving ? 'Saving compensation...' : message}</p>
      </form>
    </section>
  );
}
