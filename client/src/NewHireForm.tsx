import { useEffect, useRef, useState, type FormEvent } from 'react';
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

// AB#edit-hold-release, criterion 2: only draft and returned new hires can be edited.
const EDITABLE_STATUSES = ['draft', 'returned'];

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

interface FormBodyProps {
  // Set when editing an existing new hire: the id to save to and the status the form was loaded with.
  editing: { id: number; status: string } | null;
  initialValues: Values;
  initialRequisition: RequisitionOption | null;
}

// AB#new-hire-draft, criterion 6: labels, errors tied to fields, and focus on the first error.
// AB#edit-hold-release, criteria 1 and 2: the same form saves a new hire (POST) or edits it (PUT).
function NewHireFormBody({ editing, initialValues, initialRequisition }: FormBodyProps) {
  const [values, setValues] = useState<Values>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requisition, setRequisition] = useState<RequisitionOption | null>(initialRequisition);
  const formAlertRef = useRef<HTMLParagraphElement>(null);
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

    const payload: Record<string, unknown> = {
      ...values,
      requisitionId: requisition ? requisition.id : null,
    };
    if (editing) {
      payload.expectedStatus = editing.status;
    }

    let response: Response;
    try {
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

    const saved = editing ? response.status === 200 : response.status === 201;
    if (saved) {
      navigateTo(editing ? `/new-hires/${editing.id}` : '/new-hires');
      return;
    }

    if (editing && response.status === 409) {
      // AB#edit-hold-release, criterion 3: the record changed or can no longer be edited.
      setFormError(
        'This new hire changed since it was loaded, so your changes were not saved. Reload the page to see its current status.',
      );
      setSaving(false);
      formAlertRef.current?.focus();
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
    <form onSubmit={handleSubmit} noValidate>
      {formError && (
        <p role="alert" className="form-error" tabIndex={-1} ref={formAlertRef}>
          {formError}
        </p>
      )}
      <RequisitionPicker
        selected={requisition}
        error={fieldErrors.requisitionId}
        onSelect={selectRequisition}
      />
      <div className="field">
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
      </div>
      <div className="field">
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
      </div>
      <div className="field">
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
      </div>
      <div className="field">
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
      </div>
      <div className="field">
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
      </div>
      <div className="field">
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
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {editing ? 'Save changes' : 'Save new hire'}
        </button>
        <Link to={editing ? `/new-hires/${editing.id}` : '/new-hires'} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
      {saving && <p role="status">Saving...</p>}
    </form>
  );
}

// AB#edit-hold-release, criterion 1 and 10: the record as the edit page needs it.
interface EditRecord {
  id: number;
  status: string;
  firstName: string;
  lastName: string;
  personalEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
  requisitionId: number | null;
  requisitionNumber: string | null;
}

type EditLoad =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'notFound' }
  | { kind: 'ready'; record: EditRecord };

function isEditRecord(value: unknown): value is EditRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.status === 'string' &&
    typeof candidate.firstName === 'string' &&
    typeof candidate.lastName === 'string' &&
    typeof candidate.personalEmail === 'string' &&
    typeof candidate.jobTitle === 'string' &&
    typeof candidate.department === 'string' &&
    typeof candidate.startDate === 'string' &&
    (candidate.requisitionId === null || typeof candidate.requisitionId === 'number') &&
    (candidate.requisitionNumber === null || typeof candidate.requisitionNumber === 'string')
  );
}

async function loadForEdit(id: number, signal: AbortSignal): Promise<EditLoad> {
  try {
    const response = await fetch(`/api/new-hires/${id}`, { signal, headers: portalHeaders() });
    if (response.status === 404) {
      return { kind: 'notFound' };
    }
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (isEditRecord(body)) {
      return { kind: 'ready', record: body };
    }
  } catch {
    // Aborted or unreachable: fall through to the failed state below.
  }
  return { kind: 'failed' };
}

// AB#edit-hold-release, criteria 1 and 10: loads the record, then shows the form filled in.
function EditNewHirePage({ id }: { id: number }) {
  const [state, setState] = useState<EditLoad>({ kind: 'loading' });

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

  return (
    <main>
      <h1>Edit new hire</h1>
      {state.kind === 'loading' && <p role="status" className="state-loading">Loading new hire...</p>}
      {state.kind === 'failed' && <p role="alert">Could not load this new hire. Try again later.</p>}
      {state.kind === 'notFound' && <p role="alert">New hire not found.</p>}
      {state.kind === 'ready' && !EDITABLE_STATUSES.includes(state.record.status) && (
        <p role="alert">This new hire can no longer be edited.</p>
      )}
      {state.kind === 'ready' && EDITABLE_STATUSES.includes(state.record.status) && (
        <NewHireFormBody
          key={state.record.id}
          editing={{ id: state.record.id, status: state.record.status }}
          initialValues={{
            firstName: state.record.firstName,
            lastName: state.record.lastName,
            personalEmail: state.record.personalEmail,
            jobTitle: state.record.jobTitle,
            department: state.record.department,
            startDate: state.record.startDate,
          }}
          initialRequisition={
            state.record.requisitionId === null
              ? null
              : {
                  id: state.record.requisitionId,
                  number: state.record.requisitionNumber ?? '',
                  jobTitle: state.record.jobTitle,
                  department: state.record.department,
                  hiringManagerName: '',
                }
          }
        />
      )}
      {state.kind !== 'ready' && (
        <p>
          <Link to={`/new-hires/${id}`}>Back to new hire details</Link>
        </p>
      )}
    </main>
  );
}

// AB#new-hire-draft, criterion 6 and AB#edit-hold-release, criterion 10: the add page, or the edit page
// when an id is given.
export function NewHireFormPage({ id }: { id?: number }) {
  if (id !== undefined) {
    return <EditNewHirePage id={id} />;
  }
  return (
    <main>
      <h1>Add new hire</h1>
      <NewHireFormBody editing={null} initialValues={EMPTY_VALUES} initialRequisition={null} />
    </main>
  );
}
