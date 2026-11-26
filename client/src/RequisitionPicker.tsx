import { useEffect, useState, type KeyboardEvent } from 'react';
import { portalHeaders } from './role';

export interface RequisitionOption {
  id: number;
  number: string;
  jobTitle: string;
  department: string;
  hiringManagerName: string;
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; items: RequisitionOption[] };

// AB#requisition-link, criterion 6: searching starts at two characters.
const MIN_SEARCH_LENGTH = 2;

function isRequisitionOption(value: unknown): value is RequisitionOption {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.number === 'string' &&
    typeof candidate.jobTitle === 'string' &&
    typeof candidate.department === 'string' &&
    typeof candidate.hiringManagerName === 'string'
  );
}

async function searchRequisitions(text: string, signal: AbortSignal): Promise<SearchState> {
  try {
    const response = await fetch(`/api/requisitions?q=${encodeURIComponent(text)}`, {
      signal,
      headers: portalHeaders(),
    });
    if (!response.ok) {
      return { kind: 'failed' };
    }
    const body: unknown = await response.json();
    if (Array.isArray(body) && body.every(isRequisitionOption)) {
      return { kind: 'ready', items: body };
    }
  } catch {
    // Aborted or unreachable: the caller ignores aborted searches and shows the failed state.
  }
  return { kind: 'failed' };
}

interface RequisitionPickerProps {
  selected: RequisitionOption | null;
  error?: string;
  onSelect: (requisition: RequisitionOption | null) => void;
}

// AB#requisition-link, criteria 6 and 7: a combobox that lists open requisitions,
// supports arrow keys, Enter and Escape, and announces the results.
export function RequisitionPicker({ selected, error, onSelect }: RequisitionPickerProps) {
  // The edit form opens with the linked requisition's number in the box.
  const [text, setText] = useState(selected?.number ?? '');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const query = text.trim();
  const searching = selected === null && query.length >= MIN_SEARCH_LENGTH;
  const items = search.kind === 'ready' ? search.items : [];
  const listVisible = open && items.length > 0;

  useEffect(() => {
    if (!searching) {
      setSearch({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    setSearch({ kind: 'loading' });
    setActive(-1);
    searchRequisitions(query, controller.signal).then((result) => {
      if (!controller.signal.aborted) {
        setSearch(result);
      }
    });
    return () => controller.abort();
  }, [query, searching]);

  function handleTextChange(value: string) {
    setText(value);
    setOpen(true);
    // Editing the text drops the selection, which unlocks the job title and department.
    if (selected !== null) {
      onSelect(null);
    }
  }

  function choose(requisition: RequisitionOption) {
    setText(requisition.number);
    setOpen(false);
    setActive(-1);
    onSelect(requisition);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      }
      return;
    }
    if (items.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(open ? Math.min(active + 1, items.length - 1) : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive(open ? Math.max(active - 1, 0) : 0);
    } else if (event.key === 'Enter' && listVisible && active >= 0 && active < items.length) {
      // Enter chooses the highlighted option instead of submitting the form.
      event.preventDefault();
      choose(items[active]);
    }
  }

  let status = '';
  // Visual design story, criterion 10: a failed search is shown in the error colour, with the same text.
  let statusClass = 'field-hint';
  if (selected !== null) {
    status = `Selected ${selected.number}. Job title and department are filled in from the requisition.`;
  } else if (search.kind === 'loading') {
    status = 'Searching requisitions...';
  } else if (search.kind === 'failed') {
    status = 'Could not search requisitions. Try again.';
    statusClass = 'field-error';
  } else if (search.kind === 'ready' && searching) {
    status =
      items.length === 0
        ? 'No open requisitions match.'
        : `${items.length} ${items.length === 1 ? 'requisition' : 'requisitions'} found. Use the arrow keys to choose one.`;
  }

  const describedBy = ['requisition-hint', error ? 'error-requisitionId' : null]
    .filter((id): id is string => id !== null)
    .join(' ');

  return (
    <>
      <div className="field">
        <label htmlFor="field-requisitionId">Requisition</label>
        <input
          id="field-requisitionId"
          name="requisitionId"
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={listVisible}
          aria-controls={listVisible ? 'requisition-listbox' : undefined}
          aria-activedescendant={listVisible && active >= 0 ? `requisition-option-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={text}
          onChange={(event) => handleTextChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
        />
        {error && (
          <span id="error-requisitionId" className="field-error">
            {' '}
            {error}
          </span>
        )}
      </div>
      <p id="requisition-hint" className="field-hint">
        {selected === null
          ? 'Type at least two characters of the number or job title to find an open requisition. Optional.'
          : selected.hiringManagerName === ''
            ? 'Job title and department come from the requisition.'
            : `Hiring manager: ${selected.hiringManagerName}`}
      </p>
      {/* Options keep focus in the input on mouse down, so a click is not cut short by the blur handler. */}
      {listVisible && (
        <ul id="requisition-listbox" role="listbox" aria-label="Open requisitions">
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`requisition-option-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              {`${item.number} - ${item.jobTitle} (${item.department}), hiring manager ${item.hiringManagerName}`}
            </li>
          ))}
        </ul>
      )}
      <p role="status" className={statusClass}>{status}</p>
    </>
  );
}
