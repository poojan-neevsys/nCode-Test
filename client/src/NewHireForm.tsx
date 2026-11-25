import { useState, type FormEvent } from 'react';
import { apiFetch } from './api';
import { Link, navigateTo } from './navigation';

// Must match the field names the server returns in its 400 responses.
const FIELD_ORDER = [
  'firstName',
  'lastName',
  'personalEmail',
  'jobTitle',
  'department',
  'startDate',
] as const;

type FieldName = (typeof FIELD_ORDER)[number];
type Values = Record<FieldName, string>;
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
function readErrors(body: unknown): Record<string, string> {
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

// AB#new-hire-draft, criterion 6: labels, errors tied to fields, and focus on the first error.
export function NewHireFormPage() {
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateValue(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError('');

    let response: Response;
    try {
      response = await apiFetch('/api/new-hires', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
    } catch {
      setFormError('Could not reach the server. Your entries are kept; try again.');
      setSaving(false);
      return;
    }

    if (response.status === 201) {
      navigateTo('/new-hires');
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
    <main>
      <h1>Add new hire</h1>
      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
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
            Save new hire
          </button>{' '}
          <Link to="/new-hires">Cancel</Link>
        </p>
        {saving && <p role="status">Saving...</p>}
      </form>
    </main>
  );
}
