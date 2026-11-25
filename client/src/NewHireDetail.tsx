import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, type PortalRole } from './api';
import { Link } from './navigation';

interface Compensation {
  baseSalary: number;
  currency: string;
  bonusTargetPercent: number | null;
  updatedAt: string;
}

interface NewHireDetail {
  id: number;
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
  status: string;
  // Present only when the acting role is hr_manager.
  compensation?: Compensation | null;
}

type DetailState =
  | { kind: 'loading' }
  | { kind: 'notFound' }
  | { kind: 'failed' }
  | { kind: 'ready'; record: NewHireDetail };

function isNewHireDetail(value: unknown): value is NewHireDetail {
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
    typeof candidate.status === 'string'
  );
}

async function loadNewHire(id: number, signal: AbortSignal): Promise<DetailState> {
  try {
    const response = await apiFetch(`/api/new-hires/${id}`, { signal });
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
    // Fall through to the failed state below.
  }
  return { kind: 'failed' };
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface NewHireDetailPageProps {
  id: number;
  role: PortalRole;
}

// AB#new-hire-compensation, criteria 3 and 6: the record at /new-hires/:id.
export function NewHireDetailPage({ id, role }: NewHireDetailPageProps) {
  const [state, setState] = useState<DetailState>({ kind: 'loading' });

  useEffect(() => {
    // The role is part of the dependencies: apiFetch sends the stored role, and the
    // server decides from it whether the compensation is included in the response.
    const controller = new AbortController();
    setState({ kind: 'loading' });
    loadNewHire(id, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setState(result);
      }
    });
    return () => controller.abort();
  }, [id, role]);

  return (
    <main>
      <h1>New hire details</h1>
      {state.kind === 'loading' && <p role="status">Loading new hire...</p>}
      {state.kind === 'notFound' && <p role="alert">This new hire was not found.</p>}
      {state.kind === 'failed' && (
        <p role="alert">Could not load this new hire. Try again later.</p>
      )}
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
            <dt>Start date</dt>
            <dd>{state.record.startDate}</dd>
            <dt>Status</dt>
            <dd>{statusLabel(state.record.status)}</dd>
          </dl>
          {role === 'hr_manager' && (
            <CompensationSection
              key={`${state.record.id}-${role}`}
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

type CompensationValues = Record<'baseSalary' | 'currency' | 'bonusTargetPercent', string>;
type CompensationFieldName = keyof CompensationValues;

const COMPENSATION_FIELD_ORDER: readonly CompensationFieldName[] = [
  'baseSalary',
  'currency',
  'bonusTargetPercent',
];

function initialValues(initial: Compensation | null): CompensationValues {
  if (!initial) {
    return { baseSalary: '', currency: '', bonusTargetPercent: '' };
  }
  return {
    baseSalary: String(initial.baseSalary),
    currency: initial.currency,
    bonusTargetPercent: initial.bonusTargetPercent === null ? '' : String(initial.bonusTargetPercent),
  };
}

// Sends a number when the text is numeric. Anything else is sent as text so the server
// rejects it with a 400; an empty bonus is sent as null, meaning no bonus target.
function numberOrText(text: string): number | string | null {
  if (text.trim() === '') {
    return null;
  }
  const parsed = Number(text);
  return Number.isNaN(parsed) ? text : parsed;
}

interface CompensationSectionProps {
  newHireId: number;
  initial: Compensation | null;
}

// AB#new-hire-compensation, criteria 6 and 7: shown only to hr_manager; the server enforces it too.
function CompensationSection({ newHireId, initial }: CompensationSectionProps) {
  const [values, setValues] = useState<CompensationValues>(() => initialValues(initial));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CompensationFieldName, string>>>({});
  const [formError, setFormError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saving, setSaving] = useState(false);

  function updateValue(field: CompensationFieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError('');
    setStatusMessage('');

    let response: Response;
    try {
      response = await apiFetch(`/api/new-hires/${newHireId}/compensation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseSalary: numberOrText(values.baseSalary),
          currency: values.currency,
          bonusTargetPercent: numberOrText(values.bonusTargetPercent),
        }),
      });
    } catch {
      setFormError('Could not reach the server. Your entries are kept; try again.');
      setSaving(false);
      return;
    }

    if (response.ok) {
      setStatusMessage('Compensation saved.');
      setSaving(false);
      return;
    }

    if (response.status === 400) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // A body that is not JSON leaves the generic message below.
      }
      const rawErrors =
        typeof body === 'object' && body !== null ? (body as { errors?: unknown }).errors : undefined;
      const serverErrors: Record<string, unknown> =
        typeof rawErrors === 'object' && rawErrors !== null ? (rawErrors as Record<string, unknown>) : {};
      const known: Partial<Record<CompensationFieldName, string>> = {};
      for (const field of COMPENSATION_FIELD_ORDER) {
        const message = serverErrors[field];
        if (typeof message === 'string') {
          known[field] = message;
        }
      }
      const firstInvalid = COMPENSATION_FIELD_ORDER.find((field) => known[field] !== undefined);
      setFieldErrors(known);
      setFormError(
        firstInvalid === undefined
          ? 'Could not save compensation. Check the form and try again.'
          : 'Please correct the fields marked below.',
      );
      if (firstInvalid !== undefined) {
        document.getElementById(`compensation-${firstInvalid}`)?.focus();
      }
    } else {
      setFormError('Could not save compensation. Your entries are kept; try again.');
    }
    setSaving(false);
  }

  function describedBy(field: CompensationFieldName): string | undefined {
    return fieldErrors[field] ? `compensation-error-${field}` : undefined;
  }

  function renderError(field: CompensationFieldName) {
    const message = fieldErrors[field];
    return message ? (
      <span id={`compensation-error-${field}`} className="field-error">
        {message}
      </span>
    ) : null;
  }

  return (
    <section aria-labelledby="compensation-heading">
      <h2 id="compensation-heading">Compensation</h2>
      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <p>
          <label htmlFor="compensation-baseSalary">Base salary (whole number)</label>{' '}
          <input
            id="compensation-baseSalary"
            name="baseSalary"
            type="number"
            inputMode="numeric"
            step={1}
            min={1}
            max={10000000}
            value={values.baseSalary}
            onChange={(event) => updateValue('baseSalary', event.target.value)}
            aria-invalid={fieldErrors.baseSalary ? true : undefined}
            aria-describedby={describedBy('baseSalary')}
          />
          {renderError('baseSalary')}
        </p>
        <p>
          <label htmlFor="compensation-currency">Currency</label>{' '}
          <select
            id="compensation-currency"
            name="currency"
            value={values.currency}
            onChange={(event) => updateValue('currency', event.target.value)}
            aria-invalid={fieldErrors.currency ? true : undefined}
            aria-describedby={describedBy('currency')}
          >
            <option value="">Select a currency</option>
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </select>
          {renderError('currency')}
        </p>
        <p>
          <label htmlFor="compensation-bonusTargetPercent">Bonus target percent (optional)</label>{' '}
          <input
            id="compensation-bonusTargetPercent"
            name="bonusTargetPercent"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            max={100}
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
        <p role="status" aria-live="polite">
          {saving ? 'Saving compensation...' : statusMessage}
        </p>
      </form>
    </section>
  );
}
