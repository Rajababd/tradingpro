import type { IndicatorWorkspace, SmaRowState } from '../indicators/IndicatorWorkspace';
import { IntField } from './IntField';

/**
 * One row per SMA source, generated from the registry: Price first, then every eligible indicator output.
 * Each source has its own switch and period; turning one off keeps its period.
 */
export function SmaMenu({ workspace, rows }: { workspace: IndicatorWorkspace; rows: readonly SmaRowState[] }) {
  return (
    <ul className="menu-list">
      {rows.map((row) => (
        <li key={row.key} className="menu-row" data-displayed={row.enabled} data-sma-source={row.key}>
          <div className="row-line">
            <label className="switch-row">
              <input type="checkbox" role="switch" checked={row.enabled} onChange={(e) => workspace.setSmaEnabled(row.key, e.target.checked)} />
              <span className="switch" aria-hidden="true" />
              <span className="row-name">
                {row.label}
                {/* Only worth saying when it matters: the SMA is on but the line it reads is not drawn. */}
                {row.enabled && row.sourceDisplayed === false && <span className="note"> · source not shown</span>}
              </span>
            </label>
          </div>
          <div className="settings inline">
            <IntField label="Period" value={row.period} onCommit={(period) => workspace.setSmaPeriod(row.key, period)} />
          </div>
        </li>
      ))}
    </ul>
  );
}
