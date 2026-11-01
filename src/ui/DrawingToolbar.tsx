import { useEffect, useState } from 'react';
import type { DrawingController } from '../chart/DrawingController';

const TOOL_LABELS: Record<string, string> = {
  'trend-line': 'Trend line',
  'horizontal-line': 'Horizontal line',
  rectangle: 'Rectangle',
  'fib-retracement': 'Fib retracement',
};

const TOOL_GLYPHS: Record<string, string> = {
  'trend-line': '／',
  'horizontal-line': '━',
  rectangle: '▭',
  'fib-retracement': '⌁',
};

/** Compact vertical drawing toolbar. Tool names remain available to assistive technology. */
export function DrawingToolbar({ controller }: { controller: DrawingController | null }) {
  const [activeTool, setActiveTool] = useState<string | null>(null);

  useEffect(() => {
    if (controller === null) {
      setActiveTool(null);
      return;
    }
    const unsubscribe = controller.on('tool:changed', () => setActiveTool(controller.activeTool));
    setActiveTool(controller.activeTool);
    return unsubscribe;
  }, [controller]);

  const available = controller?.tools.filter((tool) => tool.type in TOOL_LABELS) ?? Object.keys(TOOL_LABELS).map((type) => ({
    type,
    requiredAnchors: type === 'horizontal-line' ? 1 : 2,
  }));

  return (
    <div className="drawing-toolbar" role="group" aria-label="Drawing tools">
      <span className="sr-only">Draw</span>
      {available.map((tool) => (
        <button
          key={tool.type}
          type="button"
          className="drawing-tool-button"
          aria-label={TOOL_LABELS[tool.type]}
          aria-pressed={activeTool === tool.type}\n          disabled={controller === null}
          title={`${TOOL_LABELS[tool.type]} · ${tool.requiredAnchors} click${tool.requiredAnchors === 1 ? '' : 's'}`}
          onClick={() => controller?.setActiveTool(activeTool === tool.type ? null : tool.type)}
        >
          <span aria-hidden="true">{TOOL_GLYPHS[tool.type]}</span>
        </button>
      ))}
      {activeTool !== null && (
        <button type="button" className="drawing-tool-button drawing-tool-cancel" aria-label="Cancel drawing" title="Cancel drawing" disabled={controller === null} onClick={() => controller?.setActiveTool(null)}>
          <span aria-hidden="true">×</span>
        </button>
      )}
      <span className="toolbar-divider" aria-hidden="true" />
      <button type="button" className="drawing-tool-button" aria-label="Clear drawings" title="Clear drawings" disabled={controller === null} onClick={() => controller?.clear()}>
        <span aria-hidden="true">⌫</span>
      </button>
    </div>
  );
}
