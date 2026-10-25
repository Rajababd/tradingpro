import { useEffect, useId, useState } from 'react';
import { IndicatorConfigError } from '../indicators/IndicatorEngine';

interface IntFieldProps {
  label: string;
  value: number;
  /** Applies the value; throwing an IndicatorConfigError shows its message and keeps the old value. */
  onCommit(value: number): void;
  hint?: string;
}

/**
 * A whole-number field that commits on Enter or blur, reverts on Escape, and never applies a bad value:
 * the typed text is validated, then the owner of the setting validates again and may refuse.
 */
export function IntField({ label, value, onCommit, hint }: IntFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(String(value)); // follow the real value when it changes elsewhere
    setError(null);
  }, [value]);

  const commit = () => {
    if (draft === String(value)) return setError(null);
    if (!/^\d+$/.test(draft.trim())) {
      setError('Enter a whole number');
      return;
    }
    try {
      onCommit(Number(draft.trim()));
      setError(null);
    } catch (e) {
      setError(e instanceof IndicatorConfigError ? e.errors.join('; ') : 'Could not apply that value');
    }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? `${id}-err` : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' && draft !== String(value)) {
            e.stopPropagation(); // revert the edit first; a second Escape closes the menu
            setDraft(String(value));
            setError(null);
          }
        }}
      />
      {hint !== undefined && error === null && <span className="hint">{hint}</span>}
      {error !== null && (
        <span id={`${id}-err`} className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
