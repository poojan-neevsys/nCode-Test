import { useEffect, useState, type FormEvent } from 'react';
import { readErrors } from './NewHireForm';
import { Link } from './navigation';
import { portalHeaders, type PortalRole } from './role';

// AB#letter-templates, criterion 5: placeholders a template may use. Must match the server list.
const PLACEHOLDERS = [
  'firstName',
  'lastName',
  'jobTitle',
  'department',
  'startDate',
  'requisitionNumber',
  'baseSalary',
  'currency',
];
const PLACEHOLDER_TOKENS = PLACEHOLDERS.map((name) => `{{${name}}}`).join(', ');

export interface Template {
  id: number;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface NewHireOption {
  id: number;
  fullName: string;
}

interface PreviewResult {
  text: string;
  missing: string[];
}

function isTemplate(value: unknown): value is Template {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.name === 'string' &&
    typeof candidate.body === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isNewHireOption(value: unknown): value is NewHireOption {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'number' && typeof candidate.fullName === 'string';
}

function isPreviewResult(value: unknown): value is PreviewResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.text === 'string' &&
    Array.isArray(candidate.missing) &&
    candidate.missing.every((item) => typeof item === 'string')
  );
}

// The server's own messages (for example "Only HR managers ...") are safe to show.
function serverMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
  }
  const first = Object.values(readErrors(body))[0];
  return first ?? null;
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; items: Template[] };

async function loadTemplates(signal: AbortSignal): Promise<ListState> {
  try {
    const response = await fetch('/api/templates', { signal, headers: portalHeaders() });
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (Array.isArray(body) && body.every(isTemplate)) {
      return { kind: 'ready', items: body };
    }
  } catch {
    // Aborted or unreachable: fall through to the failed state below.
  }
  return { kind: 'failed' };
}

type EditState = { kind: 'none' } | { kind: 'create' } | { kind: 'edit'; template: Template };

// AB#letter-templates, criteria 2 and 8: everyone sees the list; hr_manager can create and edit; both can preview.
export function TemplatesPage({ role }: { role: PortalRole }) {
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [editing, setEditing] = useState<EditState>({ kind: 'none' });
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const canEdit = role === 'hr_manager';

  useEffect(() => {
    const controller = new AbortController();
    loadTemplates(controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setList(result);
      }
    });
    return () => controller.abort();
  }, [reloadKey]);

  function handleSaved(saved: Template) {
    setEditing({ kind: 'none' });
    setMessage(`Saved template "${saved.name}".`);
    setReloadKey((key) => key + 1);
  }

  const items = list.kind === 'ready' ? list.items : [];

  return (
    <main>
      <h1>Letter templates</h1>
      {!canEdit && <p>Only HR managers can create or edit templates.</p>}
      {canEdit && editing.kind === 'none' && (
        <p>
          <button
            type="button"
            onClick={() => {
              setMessage('');
              setEditing({ kind: 'create' });
            }}
          >
            New template
          </button>
        </p>
      )}
      <p role="status">{message}</p>

      <h2>Templates</h2>
      {list.kind === 'loading' && <p role="status">Loading templates...</p>}
      {list.kind === 'failed' && <p role="alert">Could not load templates. Try again later.</p>}
      {list.kind === 'ready' && items.length === 0 && <p>No letter templates yet.</p>}
      {list.kind === 'ready' && items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Last updated</th>
              {canEdit && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.updatedAt.slice(0, 10)}</td>
                {canEdit && (
                  <td>
                    <button
                      type="button"
                      aria-label={`Edit ${item.name}`}
                      onClick={() => {
                        setMessage('');
                        setEditing({ kind: 'edit', template: item });
                      }}
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && editing.kind !== 'none' && (
        <TemplateForm
          key={editing.kind === 'edit' ? `edit-${editing.template.id}` : 'create'}
          template={editing.kind === 'edit' ? editing.template : null}
          onSaved={handleSaved}
          onCancel={() => setEditing({ kind: 'none' })}
        />
      )}

      <PreviewSection key={role} templates={items} />

      <p>
        <Link to="/">Back to home</Link>
      </p>
    </main>
  );
}

type FormField = 'name' | 'body';
type FormErrors = Partial<Record<FormField, string>>;
const FORM_FIELD_ORDER: readonly FormField[] = ['name', 'body'];

// AB#letter-templates, criteria 3 and 4 (HR manager form): errors are tied to fields and focus moves to the first one.
function TemplateForm({
  template,
  onSaved,
  onCancel,
}: {
  template: Template | null;
  onSaved: (saved: Template) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Start on the first field when the form opens.
  useEffect(() => {
    document.getElementById('template-name')?.focus();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError('');

    let response: Response;
    try {
      response = await fetch(template ? `/api/templates/${template.id}` : '/api/templates', {
        method: template ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify({ name, body }),
      });
    } catch {
      setFormError('Could not reach the server. Your entries are kept; try again.');
      setSaving(false);
      return;
    }

    if (response.status === 200 || response.status === 201) {
      const saved: unknown = await response.json().catch(() => null);
      if (isTemplate(saved)) {
        setSaving(false);
        onSaved(saved);
        return;
      }
      setFormError('Could not save the template. Try again.');
    } else if (response.status === 400) {
      const errorBody: unknown = await response.json().catch(() => null);
      const serverErrors = readErrors(errorBody);
      const known: FormErrors = {};
      for (const field of FORM_FIELD_ORDER) {
        if (serverErrors[field] !== undefined) {
          known[field] = serverErrors[field];
        }
      }
      const firstInvalid = FORM_FIELD_ORDER.find((field) => known[field] !== undefined);
      setFieldErrors(known);
      setFormError(
        firstInvalid === undefined
          ? 'Could not save the template. Check the form and try again.'
          : 'Please correct the fields marked below.',
      );
      if (firstInvalid !== undefined) {
        document.getElementById(`template-${firstInvalid}`)?.focus();
      }
    } else if (response.status === 403) {
      setFormError('Only HR managers can change letter templates.');
    } else {
      setFormError('Could not save the template. Your entries are kept; try again.');
    }
    setSaving(false);
  }

  function describedBy(field: FormField, helpId?: string): string | undefined {
    const ids = [helpId, fieldErrors[field] ? `template-error-${field}` : undefined].filter(
      (id): id is string => id !== undefined,
    );
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  function renderError(field: FormField) {
    const message = fieldErrors[field];
    return message ? (
      <span id={`template-error-${field}`} className="field-error">
        {message}
      </span>
    ) : null;
  }

  return (
    <section aria-labelledby="template-form-heading">
      <h2 id="template-form-heading">{template ? 'Edit template' : 'New template'}</h2>
      {formError && (
        <p role="alert" className="form-error">
          {formError}
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate>
        <p>
          <label htmlFor="template-name">Template name (up to 100 characters)</label>{' '}
          <input
            id="template-name"
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={describedBy('name')}
          />
          {renderError('name')}
        </p>
        <p>
          <label htmlFor="template-body">Letter text (plain text, up to 20000 characters)</label>
          <br />
          <span id="template-body-help">Allowed placeholders: {PLACEHOLDER_TOKENS}</span>
          <br />
          <textarea
            id="template-body"
            name="body"
            rows={12}
            cols={80}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-invalid={fieldErrors.body ? true : undefined}
            aria-describedby={describedBy('body', 'template-body-help')}
          />
          <br />
          {renderError('body')}
        </p>
        <p>
          <button type="submit" disabled={saving}>
            Save template
          </button>{' '}
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </p>
        {saving && <p role="status">Saving template...</p>}
      </form>
    </section>
  );
}

type HireListState = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; items: NewHireOption[] };

async function loadNewHireOptions(signal: AbortSignal): Promise<HireListState> {
  try {
    const response = await fetch('/api/new-hires', { signal, headers: portalHeaders() });
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (Array.isArray(body) && body.every(isNewHireOption)) {
      return { kind: 'ready', items: body };
    }
  } catch {
    // Aborted or unreachable: fall through to the failed state below.
  }
  return { kind: 'failed' };
}

// AB#letter-templates, criteria 6, 7 and 8: pick a template and a new hire, then see the preview.
// The text is rendered as plain text, so nothing in a name or template is run as HTML.
function PreviewSection({ templates }: { templates: Template[] }) {
  const [hires, setHires] = useState<HireListState>({ kind: 'loading' });
  const [templateId, setTemplateId] = useState('');
  const [newHireId, setNewHireId] = useState('');
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadNewHireOptions(controller.signal).then((state) => {
      if (!controller.signal.aborted) {
        setHires(state);
      }
    });
    return () => controller.abort();
  }, []);

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setPreviewError('');

    if (templateId === '' || newHireId === '') {
      const missingField = templateId === '' ? 'preview-template' : 'preview-new-hire';
      setPreviewError(templateId === '' ? 'Choose a template.' : 'Choose a new hire.');
      document.getElementById(missingField)?.focus();
      return;
    }

    setPending(true);
    let response: Response;
    try {
      response = await fetch(`/api/templates/${templateId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify({ newHireId: Number(newHireId) }),
      });
    } catch {
      setPreviewError('Could not reach the server. Try again.');
      setPending(false);
      return;
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.ok && isPreviewResult(body)) {
      setResult(body);
    } else {
      setPreviewError(serverMessage(body) ?? 'Could not show the preview. Try again.');
    }
    setPending(false);
  }

  return (
    <section aria-labelledby="preview-heading">
      <h2 id="preview-heading">Preview</h2>
      <form onSubmit={handlePreview} noValidate>
        <p>
          <label htmlFor="preview-template">Template</label>{' '}
          <select
            id="preview-template"
            name="template"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">Choose a template</option>
            {templates.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor="preview-new-hire">New hire</label>{' '}
          <select
            id="preview-new-hire"
            name="newHire"
            value={newHireId}
            disabled={hires.kind !== 'ready'}
            onChange={(event) => setNewHireId(event.target.value)}
          >
            <option value="">Choose a new hire</option>
            {hires.kind === 'ready' &&
              hires.items.map((hire) => (
                <option key={hire.id} value={String(hire.id)}>
                  {hire.fullName}
                </option>
              ))}
          </select>
        </p>
        {hires.kind === 'loading' && <p role="status">Loading new hires...</p>}
        {hires.kind === 'failed' && <p role="alert">Could not load new hires. Try again later.</p>}
        <p>
          <button type="submit" disabled={pending}>
            Show preview
          </button>
        </p>
      </form>

      {pending && <p role="status">Loading preview...</p>}
      {previewError && <p role="alert">{previewError}</p>}
      {result && (
        <>
          <div role="region" aria-label="Letter preview" className="letter-preview" style={{ whiteSpace: 'pre-wrap' }}>
            {result.text}
          </div>
          {result.missing.length > 0 && (
            <p>
              No value for {result.missing.join(', ')}; shown as empty text.
            </p>
          )}
        </>
      )}
    </section>
  );
}
