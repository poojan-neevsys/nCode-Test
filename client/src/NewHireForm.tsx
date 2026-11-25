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

// AB#edit-new-hire, criterion 1: only draft and returned records can be edited.
const EDITABLE_STATUSES: readonly string[] = ['draft', 'returned'];

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

// AB#edit-new-hire, criterion 3: the fields of a record the edit form fills in.
interface EditRecord {
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
  requisitionHiringManagerName: string | null;
}

type EditState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'notFound' }
  | { kind: 'notEditable' }
  | { kind: 'ready'; record: EditRecord };

function isEditRecord(value: unknown): value is EditRecord {
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
    (candidate.requisitionHiringManagerName === null ||
      typeof candidate.requisitionHiringManagerName === 'string')
  );
}

// AB#edit-new-hire, criterion 3: loads the record for the edit page. Anything but draft or returned is refused.
async function loadForEdit(id: number, signal: AbortSignal): Promise<EditState> {
  try {
    const response = await fetch(`/api/new-hires/${id}`, { signal, headers: portalHeaders() });
    if (response.status === 404) {
      return { kind: 'notFound' };
    }
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (!isEditRecord(body)) {
      return { kind: 'failed' };
    }
    if (!EDITABLE_STATUSES.includes(body.status)) {
      return { kind: 'notEditable' };
    }
    return { kind: 'ready', record: body };
  } catch {
    // Aborted or unreachable: fall through to the failed state below.
  }
  return { kind: 'failed' };
}

function valuesFrom(record: EditRecord): Values {
  return {
    firstName: record.firstName,
    lastName: record.lastName,
    personalEmail: record.personalEmail,
    jobTitle: record.jobTitle,
    department: record.department,
    startDate: record.startDate,
  };
}

// The linked requisition, shown and locked in the picker the same way as on create.
function requisitionFrom(record: EditRecord): RequisitionOption | null {
  if (record.requisitionId === null || record.requisitionNumber === null) {
    return null;
  }
  return {
    id: record.requisitionId,
    number: record.requisitionNumber,
    jobTitle: record.jobTitle,
    department: record.department,
    hiringManagerName: record.requisitionHiringManagerName ?? '',
  };
}

// AB#new-hire-draft, criterion 6: labels, errors tied to fields, and focus on the first error.
// AB#edit-new-hire, criteria 1 to 5: with editId the same form loads a draft or returned new hire and saves it.
export function NewHireFormPage({ editId }: { editId?: number } = {}) {
  const isEdit = editId !== undefined;
  const [editState, setEditState] = useState<EditState>(isEdit ? { kind: 'loading' } : { kind: 'idle' });
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requisition, setRequisition] = useState<RequisitionOption | null>(null);
  // AB#requisition-link, criterion 6: while a requisition is selected, job title and department are locked.
  const locked = requisition !== null;

  useEffect(() => {
    if (editId === undefined) {
      return;
    }
    const controller = new AbortController();
    setEditState({ kind: 'loading' });
    loadForEdit(editId, controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (result.kind === 'ready') {
        setValues(valuesFrom(result.record));
        setRequisition(requisitionFrom(result.record));
      }
      setEditState(result);
    });
    return () => controller.abort();
  }, [editId]);

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

    const payload = { ...values, requisitionId: requisition ? requisition.id : null };
    let response: Response;
    try {
      if (editId === undefined) {
        response = await fetch('/api/new-hires', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...portalHeaders() },
          body: JSON.stringify(payload),
        });
      } else {
        // AB#edit-new-hire, criterion 2: the status the form was loaded with is sent back for the server to check.
        const expectedStatus = editState.kind === 'ready' ? editState.record.status : '';
        response = await fetch(`/api/new-hires/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...portalHeaders() },
          body: JSON.stringify({ ...payload, expectedStatus }),
        });
      }
    } catch {
      setFormError('Could not reach the server. Your entries are kept; try again.');
      setSaving(false);
      return;
    }

    if (response.status === (editId === undefined ? 201 : 200)) {
      navigateTo(editId === undefined ? '/new-hires' : `/new-hires/${editId}`);
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
    } else if (editId !== undefined && response.status === 409) {
      setFormError('This new hire can no longer be edited. Open its details to see the current status.');
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

  if (isEdit && editState.kind !== 'ready') {
    return (
      <main>
        <h1>Edit new hire</h1>
        {editState.kind === 'loading' && <p role="status">Loading new hire...</p>}
        {editState.kind === 'failed' && (
          <p role="alert">Could not load this new hire. Try again later.</p>
        )}
        {editState.kind === 'notFound' && <p role="alert">New hire not found.</p>}
        {editState.kind === 'notEditable' && (
          <p role="alert">Only a new hire that is a draft or has been returned can be edited.</p>
        )}
        <p>
          <Link to="/new-hires">Back to new hires</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>{isEdit ? 'Edit new hire' : 'Add new hire'}</h1>
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
            {isEdit ? 'Save changes' : 'Save new hire'}
          </button>{' '}
          <Link to={isEdit ? `/new-hires/${editId}` : '/new-hires'}>Cancel</Link>
        </p>
        {saving && <p role="status">Saving...</p>}
      </form>
    </main>
  );
}
