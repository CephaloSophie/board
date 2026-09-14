import { useState } from 'react';

// Chip editor for free-form labels: Enter or comma adds, ✕ removes.
export default function LabelsInput({
  value,
  onChange,
  suggestions = [],
  disabled,
  placeholder = 'Ajouter une étiquette…',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const listId = `labels-${Math.random().toString(36).slice(2, 8)}`;

  function add(raw: string) {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setDraft('');
  }

  return (
    <div className={`labels-input${disabled ? ' disabled' : ''}`}>
      {value.map((label) => (
        <span className="label-chip" key={label}>
          {label}
          {!disabled && (
            <button type="button" onClick={() => onChange(value.filter((l) => l !== label))} aria-label={`Retirer ${label}`}>
              ✕
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <>
          <input
            type="text"
            list={listId}
            value={draft}
            placeholder={value.length ? '' : placeholder}
            onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && value.length) {
                onChange(value.slice(0, -1));
              }
            }}
            onBlur={() => draft && add(draft)}
          />
          <datalist id={listId}>
            {suggestions
              .filter((s) => !value.includes(s))
              .slice(0, 50)
              .map((s) => (
                <option key={s} value={s} />
              ))}
          </datalist>
        </>
      )}
    </div>
  );
}
