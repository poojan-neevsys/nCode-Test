import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
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

// AB#status-workflow, criterion 7: one entry of the status history, as the server returns it.
interface HistoryEntry {
  id: number;
  fromStatus: string;
  toStatus: string;
  action: string;
  role: string;
  comment: string | null;
  createdAt: string;
}

type Action = 'submit' | 'approve' | 'return';

// AB#status-workflow: mirrors the server rules so that only the allowed buttons are shown.
// The server checks every action again, so this list is for display only.
const ACTION_RULES: Record<Action, { roles: readonly PortalRole[]; from: readonly string[] }> = {
  submit: { roles: ['hr_coordinator', 'hr_manager'], from: ['draft', 'returned'] },
  approve: { roles: ['hr_manager'], from: ['in_review'] },
  return: { roles: ['hr_manager'], from: ['in_review'] },
};
const ACTION_ORDER: readonly Action[] = ['submit', 'approve', 'return'];
const ACTION_LABELS: Record<Action, string> = {
  submit: 'Submit for review',
  approve: 'Approve',
  return: 'Return',
};
const ROLE_LABELS: Record<string, string> = {
  hr_coordinator: 'HR coordinator',
  hr_manager: 'HR manager',
};
// AB#status-workflow, criterion 6: the return comment is limited to 500 characters.
const COMMENT_MAX_LENGTH = 500;

function allowedActionsFor(role: PortalRole, status: string): Action[] {
  return ACTION_ORDER.filter(
    (action) => ACTION_RULES[action].roles.includes(role) && ACTION_RULES[action].from.includes(status),
  );
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

// The most recent return comment, or undefined when the record was never returned with one.
function latestReturnEntry(history: HistoryEntry[]): HistoryEntry | undefined {
  return [...history]
    .reverse()
    .find((entry) => entry.action === 'return' && entry.comment !== null);
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'notFound' }
  | { kind: 'ready'; record: NewHireDetailRecord; history: HistoryEntry[] };

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

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.fromStatus === 'string' &&
    typeof candidate.toStatus === 'string' &&
    typeof candidate.action === 'string' &&
    typeof candidate.role === 'string' &&
    (candidate.comment === null || typeof candidate.comment === 'string') &&
    typeof candidate.createdAt === 'string'
  );
}

async function loadNewHire(id: number, signal: AbortSignal): Promise<LoadState> {
  try {
    const [detailResponse, historyResponse] = await Promise.all([
      fetch(`/api/new-hires/${id}`, { signal, headers: portalHeaders() }),
      fetch(`/api/new-hires/${id}/history`, { signal, headers: portalHeaders() }),
    ]);
    if (detailResponse.status === 404) {
      return { kind: 'notFound' };
    }
    if (!detailResponse.ok || !historyResponse.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await detailResponse.json();
    const history: unknown = await historyResponse.json();
    if (isNewHireDetail(body) && Array.isArray(history) && history.every(isHistoryEntry)) {
      return { kind: 'ready', record: body, history };
    }
  } catch {
    // Aborted or unreachable: fall through to the failed state below.
  }
  return { kind: 'failed' };
}

// Reads { "error": "...", "reasons": [...] } from a 409 response and ignores anything else.
function readReasons(body: unknown): string[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const reasons = (body as { reasons?: unknown }).reasons;
  return Array.isArray(reasons) ? reasons.filter((reason): reason is string => typeof reason === 'string') : [];
}

function readMessage(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const message = (body as { error?: unknown }).error;
  return typeof message === 'string' ? message : '';
}

// AB#comp-view, criterion 7: the detail page. The compensation section is only rendered for hr_manager.
// AB#status-workflow, criteria 8 to 10: status, allowed actions, history, and the return dialog.
export function NewHireDetailPage({ id, role }: { id: number; role: PortalRole }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionReasons, setActionReasons] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [returnCommentError, setReturnCommentError] = useState('');
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const returnCommentRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const actionAlertRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);

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

  // AB#status-workflow, criterion 9: focus moves into the return dialog when it opens.
  useEffect(() => {
    if (returnOpen) {
      returnCommentRef.current?.focus();
    }
  }, [returnOpen]);

  // AB#status-workflow, criterion 9: Escape closes the dialog and focus goes back to the Return button.
  function closeReturnDialog() {
    setReturnOpen(false);
    setReturnCommentError('');
    returnButtonRef.current?.focus();
  }

  // AB#status-workflow, criterion 9: Tab and Shift+Tab stay inside the dialog while it is open.
  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeReturnDialog();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled])'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    const active = document.activeElement;
    const outside = !dialogRef.current.contains(active);
    if (event.shiftKey && (active === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  }

  // AB#status-workflow, criteria 2 to 6: sends one action. The server decides whether it is allowed.
  async function runAction(
    record: NewHireDetailRecord,
    action: Action,
    comment: string | null,
  ): Promise<boolean> {
    setBusyAction(action);
    setActionError('');
    setActionReasons([]);
    setActionMessage('');

    let response: Response;
    try {
      response = await fetch(`/api/new-hires/${record.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...portalHeaders() },
        body: JSON.stringify({ action, expectedStatus: record.status, comment }),
      });
    } catch {
      setActionError('Could not reach the server. Try again.');
      setBusyAction(null);
      actionAlertRef.current?.focus();
      return false;
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A body that is not JSON leaves the generic messages below.
    }

    if (response.status === 200) {
      const refreshed = await loadNewHire(record.id, new AbortController().signal);
      setState(refreshed);
      setReturnOpen(false);
      setReturnComment('');
      setBusyAction(null);
      if (refreshed.kind === 'ready') {
        setActionMessage(`Status is now ${statusLabel(refreshed.record.status)}.`);
      }
      messageRef.current?.focus();
      return true;
    }

    if (response.status === 400) {
      const serverErrors = readErrors(body);
      if (serverErrors.comment !== undefined) {
        setReturnCommentError(serverErrors.comment);
        returnCommentRef.current?.focus();
      } else {
        setActionError('Could not complete this action. Check the details and try again.');
        actionAlertRef.current?.focus();
      }
    } else if (response.status === 409) {
      // The status may have changed: show the reasons and reload the current status.
      setActionError(readMessage(body) || 'This action cannot be completed now.');
      setActionReasons(readReasons(body));
      setReturnOpen(false);
      setReturnCommentError('');
      const refreshed = await loadNewHire(record.id, new AbortController().signal);
      setState(refreshed);
      actionAlertRef.current?.focus();
    } else if (response.status === 403) {
      setActionError('Your role cannot perform this action.');
      actionAlertRef.current?.focus();
    } else {
      setActionError('Could not complete this action. Try again.');
      actionAlertRef.current?.focus();
    }
    setBusyAction(null);
    return false;
  }

  // AB#status-workflow, criterion 6: the comment is checked here too, before the request is sent.
  async function confirmReturn(record: NewHireDetailRecord) {
    // Length is checked on the raw text, before trimming, the same as the server does.
    if (Array.from(returnComment).length > COMMENT_MAX_LENGTH) {
      setReturnCommentError(`Comment must be ${COMMENT_MAX_LENGTH} characters or fewer.`);
      returnCommentRef.current?.focus();
      return;
    }
    const trimmed = returnComment.trim();
    if (trimmed === '') {
      setReturnCommentError('Enter a comment explaining what needs to change.');
      returnCommentRef.current?.focus();
      return;
    }
    setReturnCommentError('');
    await runAction(record, 'return', trimmed);
  }

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
          {state.record.status === 'returned' &&
            (() => {
              const returned = latestReturnEntry(state.history);
              return returned ? (
                <section aria-labelledby="return-note-heading">
                  <h2 id="return-note-heading">Returned for changes</h2>
                  <p>{returned.comment}</p>
                  <p>{`Returned by ${roleLabel(returned.role)} on ${formatDate(returned.createdAt)}.`}</p>
                </section>
              ) : null;
            })()}
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

          <section aria-labelledby="review-heading">
            <h2 id="review-heading">Review</h2>
            <div ref={actionAlertRef} tabIndex={-1}>
              {actionError && (
                <div role="alert" className="form-error">
                  <p>{actionError}</p>
                  {actionReasons.length > 0 && (
                    <ul>
                      {actionReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <p>
              {allowedActionsFor(role, state.record.status).map((action, index) => (
                <Fragment key={action}>
                  {index > 0 && ' '}
                  {action === 'return' ? (
                    <button
                      ref={returnButtonRef}
                      type="button"
                      onClick={() => setReturnOpen(true)}
                      disabled={busyAction !== null}
                    >
                      {ACTION_LABELS[action]}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => runAction(state.record, action, null)}
                      disabled={busyAction !== null}
                    >
                      {ACTION_LABELS[action]}
                    </button>
                  )}
                </Fragment>
              ))}
            </p>
            {returnOpen && (
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="return-dialog-title"
                onKeyDown={handleDialogKeyDown}
              >
                <h3 id="return-dialog-title">Return new hire</h3>
                <p>
                  <label htmlFor="return-comment">
                    Comment for the HR coordinator (required, up to {COMMENT_MAX_LENGTH} characters)
                  </label>
                </p>
                <p>
                  <textarea
                    id="return-comment"
                    name="comment"
                    rows={4}
                    cols={50}
                    value={returnComment}
                    ref={returnCommentRef}
                    onChange={(event) => setReturnComment(event.target.value)}
                    aria-invalid={returnCommentError ? true : undefined}
                    aria-describedby={returnCommentError ? 'return-comment-error' : undefined}
                  />
                </p>
                {returnCommentError && (
                  <p>
                    <span id="return-comment-error" className="field-error">
                      {returnCommentError}
                    </span>
                  </p>
                )}
                <p>
                  <button
                    type="button"
                    onClick={() => confirmReturn(state.record)}
                    disabled={busyAction !== null}
                  >
                    Return new hire
                  </button>{' '}
                  <button type="button" onClick={closeReturnDialog}>
                    Cancel
                  </button>
                </p>
              </div>
            )}
            <p role="status" tabIndex={-1} ref={messageRef}>
              {busyAction !== null ? 'Updating status...' : actionMessage}
            </p>
          </section>

          <section aria-labelledby="history-heading">
            <h2 id="history-heading">Status history</h2>
            {state.history.length === 0 ? (
              <p>No status changes yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Action</th>
                    <th scope="col">Role</th>
                    <th scope="col">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {state.history.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                      </td>
                      <td>{statusLabel(entry.fromStatus)}</td>
                      <td>{statusLabel(entry.toStatus)}</td>
                      <td>{ACTION_LABELS[entry.action as Action] ?? entry.action}</td>
                      <td>{roleLabel(entry.role)}</td>
                      <td>{entry.comment ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

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
