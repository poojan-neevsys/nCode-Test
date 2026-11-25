import { useEffect, useState, type FormEvent } from 'react';
import { Link, navigateTo } from './navigation';
import { RequisitionPicker, type RequisitionOption } from './RequisitionPicker';
import { portalHeaders } from './role';

// Must match the field names the server returns in its 400 responses.
const FIELD_ORDER = [
  'requisitionId',
  'firstName',
  'lastName',
  'personalEmail',
  'jobTitle',
  'department',
  'startDate',
] as const;

type FieldName = (typeof FIELD_ORDER)[number];
type TextField = Exclude<FieldName, 'requisitionId'>;
type Values = Record<TextField, string>;
type FieldErrors = Partial<Record<FieldName, string>>;

const DEPARTMENTS = ['Engineering', 'Finance', 'HR', 'Operations', 'Sales'];

const EMPTY_VALUES: Values = {
  firstName: '',
  lastName: '',
  personalEmail: '',
  jobTitle: '',
  department: '',
  startDate: '',
};

function isFieldName(value: string): value is FieldName {
  return (FIELD_ORDER as readonly string[]).includes(value);
}
// Reads { "errors": { "<field>": "<message>" } } and ignores anything else.
export function readErrors(body: unknown): Record<string, string> {
  if (typeof body !== 'object' || body === null) {
    return {};
  }
  const errors = (body as { errors?: unknown }).errors;
  if (typeof errors !== 'object' || errors === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    if (typeof message === 'string') {
      result[key] = message;
    }
  }
  return result;
}

// AB#new-hire-edit, criterion 1: the form edits an existing draft or returned new hire when this is given.
export interface EditingNewHire {
  id: number;
  status: string;
  values: Values;
  requisition: RequisitionOption | null;
}

// AB#new-hire-draft, criterion 6: labels, errors tied to fields, and focus on the first error.
export function NewHireFormPage({ editing }: { editing?: EditingNewHire }) {
  const [values, setValues] = useState<Values>(editing ? editing.values : EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requisition, setRequisition] = useState<RequisitionOption | null>(editing ? editing.requisition : null);
  // AB#requisition-link, criterion 6: while a requisition is selected, job title and department are locked.
  const locked = requisition !== null;

  function updateValue(field: TextField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  // AB#requisition-link, criterion 6: choosing a requisition fills and locks the job title and department.
  function selectRequisition(next: RequisitionOption | null) {
    setRequisition(next);
    if (next !== null) {
      setValues((current) => ({
        ...current,
        jobTitle: next.jobTitle,
        department: next.department,
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError('');

    let response: Response;
    try {
      // AB#new-hire-edit, criterion 2: an edit sends the status the form was opened with.
      const payload = {
        ...values,
        requisitionId: requisition ? requisition.id : null,
        ...(editing ? { expectedStatus: editing.status } : {}),
      };
      response = await fetch(editing ? `/api/new-hires/${editing.id}` : '/api/new-hires', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify(payload),
      });
    } catch {
      setFormError('Could not reach the server. Your entries are kept; try again.');
      setSaving(false);
      return;
    }

    if (response.status === (editing ? 200 : 201)) {
      navigateTo(editing ? `/new-hires/${editing.id}` : '/new-hires');
      return;
    }

    if (response.status === 400) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // A body that is not JSON leaves the generic message below.
      }
      const serverErrors = readErrors(body);
      const known: FieldErrors = {};
      for (const [key, message] of Object.entries(serverErrors)) {
        if (isFieldName(key)) {
          known[key] = message;
        }
      }
      const firstInvalid = FIELD_ORDER.find((field) => known[field] !== undefined);
      setFieldErrors(known);
      setFormError(
        firstInvalid === undefined
          ? 'Could not save the new hire. Check the form and try again.'
          : 'Please correct the fields marked below.',
      );
      if (firstInvalid !== undefined) {
        document.getElementById(`field-${firstInvalid}`)?.focus();
      }
    } else if (response.status === 409) {
      // AB#new-hire-edit, criterion 3: the record changed or can no longer be edited.
      setFormError('This new hire has changed or can no longer be edited. Reload the page to see its current status.');
    } else {
      setFormError('Could not save the new hire. Your entries are kept; try again.');
    }
    setSaving(false);
  }

  function describedBy(field: FieldName): string | undefined {
    return fieldErrors[field] ? `error-${field}` : undefined;
  }

  function renderError(field: FieldName) {
    const message = fieldErrors[field];
    return message ? (
      <span id={`error-${field}`} className="field-error">
        {message}
      </span>
    ) : null;
  }

  return (
    <main>
      <h1>{editing ? 'Edit new hire' : 'Add new hire'}</h1>
      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <RequisitionPicker
          selected={requisition}
          error={fieldErrors.requisitionId}
          onSelect={selectRequisition}
        />
        <p>
          <label htmlFor="field-firstName">First name</label>{' '}
          <input
            id="field-firstName"
            name="firstName"
            type="text"
            autoComplete="off"
            value={values.firstName}
            onChange={(event) => updateValue('firstName', event.target.value)}
            aria-invalid={fieldErrors.firstName ? true : undefined}
            aria-describedby={describedBy('firstName')}
          />
          {renderError('firstName')}
        </p>
        <p>
          <label htmlFor="field-lastName">Last name</label>{' '}
          <input
            id="field-lastName"
            name="lastName"
            type="text"
            autoComplete="off"
            value={values.lastName}
            onChange={(event) => updateValue('lastName', event.target.value)}
            aria-invalid={fieldErrors.lastName ? true : undefined}
            aria-describedby={describedBy('lastName')}
          />
          {renderError('lastName')}
        </p>
        <p>
          <label htmlFor="field-personalEmail">Personal email</label>{' '}
          <input
            id="field-personalEmail"
            name="personalEmail"
            type="email"
            autoComplete="off"
            value={values.personalEmail}
            onChange={(event) => updateValue('personalEmail', event.target.value)}
            aria-invalid={fieldErrors.personalEmail ? true : undefined}
            aria-describedby={describedBy('personalEmail')}
          />
          {renderError('personalEmail')}
        </p>
        <p>
          <label htmlFor="field-jobTitle">Job title</label>{' '}
          <input
            id="field-jobTitle"
            name="jobTitle"
            type="text"
            autoComplete="off"
            value={values.jobTitle}
            disabled={locked}
            onChange={(event) => updateValue('jobTitle', event.target.value)}
            aria-invalid={fieldErrors.jobTitle ? true : undefined}
            aria-describedby={describedBy('jobTitle')}
          />
          {renderError('jobTitle')}
        </p>
        <p>
          <label htmlFor="field-department">Department</label>{' '}
          <select
            id="field-department"
            name="department"
            value={values.department}
            disabled={locked}
            onChange={(event) => updateValue('department', event.target.value)}
            aria-invalid={fieldErrors.department ? true : undefined}
            aria-describedby={describedBy('department')}
          >
            <option value="">Select a department</option>
            {DEPARTMENTS.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
          {renderError('department')}
        </p>
        <p>
          <label htmlFor="field-startDate">Start date</label>{' '}
          <input
            id="field-startDate"
            name="startDate"
            type="date"
            value={values.startDate}
            onChange={(event) => updateValue('startDate', event.target.value)}
            aria-invalid={fieldErrors.startDate ? true : undefined}
            aria-describedby={describedBy('startDate')}
          />
          {renderError('startDate')}
        </p>
        <p>
          <button type="submit" disabled={saving}>
            {editing ? 'Save changes' : 'Save new hire'}
          </button>{' '}
          <Link to={editing ? `/new-hires/${editing.id}` : '/new-hires'}>Cancel</Link>
        </p>
        {saving && <p role="status">Saving...</p>}
      </form>
    </main>
  );
}

// The fields of a new hire that the edit page reads from the detail API.
interface EditSource {
  id: number;
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
  status: string;
  requisitionId: number | null;
  requisitionNumber: string | null;
  requisitionHiringManager: string | null;
}

type EditLoadState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'notFound' }
  | { kind: 'ready'; source: EditSource };

// AB#new-hire-edit, criterion 2 and 10: only draft and returned records can be edited.
const EDITABLE_STATUSES = ['draft', 'returned'];

function isEditSource(value: unknown): value is EditSource {
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
    (candidate.requisitionId === null || typeof candidate.requisitionId === 'number') &&
    (candidate.requisitionNumber === null || typeof candidate.requisitionNumber === 'string') &&
    (candidate.requisitionHiringManager === null || typeof candidate.requisitionHiringManager === 'string')
  );
}

async function loadForEdit(id: number, signal: AbortSignal): Promise<EditLoadState> {
  try {
    const response = await fetch(`/api/new-hires/${id}`, { signal, headers: portalHeaders() });
    if (response.status === 404) {
      return { kind: 'notFound' };
    }
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (isEditSource(body)) {
      return { kind: 'ready', source: body };
    }
  } catch {
    // Aborted or unreachable: fall through to the failed state below.
  }
  return { kind: 'failed' };
}

// AB#new-hire-edit, criteria 1 and 2: /new-hires/<id>/edit loads the record and shows the form filled in.
export function NewHireEditPage({ id }: { id: number }) {
  const [state, setState] = useState<EditLoadState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    loadForEdit(id, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setState(result);
      }
    });
    return () => controller.abort();
  }, [id]);

  if (state.kind === 'loading') {
    return (
      <main>
        <h1>Edit new hire</h1>
        <p role="status">Loading new hire...</p>
      </main>
    );
  }
  if (state.kind === 'failed') {
    return (
      <main>
        <h1>Edit new hire</h1>
        <p role="alert">Could not load this new hire. Try again later.</p>
        <p>
          <Link to="/new-hires">Back to new hires</Link>
        </p>
      </main>
    );
  }
  if (state.kind === 'notFound') {
    return (
      <main>
        <h1>Edit new hire</h1>
        <p role="alert">New hire not found.</p>
        <p>
          <Link to="/new-hires">Back to new hires</Link>
        </p>
      </main>
    );
  }

  const { source } = state;
  if (!EDITABLE_STATUSES.includes(source.status)) {
    return (
      <main>
        <h1>Edit new hire</h1>
        <p role="alert">Only draft or returned new hires can be edited.</p>
        <p>
          <Link to={`/new-hires/${id}`}>Back to the new hire</Link>
        </p>
      </main>
    );
  }

  const requisition: RequisitionOption | null =
    source.requisitionId === null || source.requisitionNumber === null
      ? null
      : {
          id: source.requisitionId,
          number: source.requisitionNumber,
          jobTitle: source.jobTitle,
          department: source.department,
          hiringManagerName: source.requisitionHiringManager ?? '',
        };

  return (
    <NewHireFormPage
      editing={{
        id,
        status: source.status,
        values: {
          firstName: source.firstName,
          lastName: source.lastName,
          personalEmail: source.personalEmail,
          jobTitle: source.jobTitle,
          department: source.department,
          startDate: source.startDate,
        },
        requisition,
      }}
    />
  );
}
