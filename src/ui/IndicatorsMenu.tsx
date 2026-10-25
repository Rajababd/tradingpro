import { useState } from 'react';
import type { IndicatorWorkspace, IndicatorRowState } from '../indicators/IndicatorWorkspace';
import { IntField } from './IntField';

/**
 * One row per registered indicator: a switch (its state is READ from the workspace, never kept here),
 * and, where there is something to configure, a settings section.
 */
export function IndicatorsMenu({ workspace, rows }: { workspace: IndicatorWorkspace; rows: readonly IndicatorRowState[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <ul className="menu-list">
      {rows.map((row) => {
        const hasSettings = row.paramSpecs.length > 0 || row.outputs.length > 1;
        const open = expanded === row.definitionId;
        return (
          <li key={row.definitionId} className="menu-row" data-displayed={row.displayed} data-indicator={row.definitionId}>
            <div className="row-line">
              <label className="switch-row">
                <input
                  type="checkbox"
                  role="switch"
                  checked={row.displayed}
                  onChange={(e) => workspace.setIndicatorDisplayed(row.definitionId, e.target.checked)}
                />
                <span className="switch" aria-hidden="true" />
                <span className="row-name">{row.name}</span>
              </label>
              {hasSettings && (
                <button
                  type="button"
                  className="icon-button"
                  aria-expanded={open}
                  aria-label={`${row.name} settings`}
                  onClick={() => setExpanded(open ? null : row.definitionId)}
                >
                  ⚙
                </button>
              )}
            </div>
            {hasSettings && open && (
              <div className="settings">
                {row.outputs.length > 1 && (
                  <fieldset className="outputs">
                    <legend>Lines</legend>
                    {row.outputs.map((o) => (
                      <label key={o.key} className="chip">
                        <input type="checkbox" checked={o.visible} onChange={(e) => workspace.setOutputVisible(row.definitionId, o.key, e.target.checked)} />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {row.paramSpecs.map((spec) => (
                  <IntField
                    key={spec.key}
                    label={spec.label}
                    value={row.params[spec.key] ?? 0}
                    hint={`${spec.min}–${spec.max}`}
                    onCommit={(value) => workspace.setIndicatorParams(row.definitionId, { [spec.key]: value })}
                  />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
