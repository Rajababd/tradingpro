import { useEffect, useState } from 'react';
import type { DrawingController } from '../chart/DrawingController';

const TOOL_LABELS: Record<string, string> = {
  'trend-line': 'Trend line',
  'horizontal-line': 'Horizontal line',
  rectangle: 'Rectangle',
  'fib-retracement': 'Fib retracement',
};

/** Minimal first-pass toolbar for interactive drawing placement on the price pane. */
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

  if (controller === null) return null;
  const available = controller.tools.filter((tool) => tool.type in TOOL_LABELS);

  return (
    <div className="drawing-toolbar" role="group" aria-label="Drawing tools">
      <span className="drawing-toolbar-label">Draw</span>
      {available.map((tool) => (
        <button
          key={tool.type}
          type="button"
          className="drawing-tool-button"
          aria-pressed={activeTool === tool.type}
          title={`${TOOL_LABELS[tool.type]} · ${tool.requiredAnchors} click${tool.requiredAnchors === 1 ? '' : 's'}`}
          onClick={() => controller.setActiveTool(activeTool === tool.type ? null : tool.type)}
        >
          {TOOL_LABELS[tool.type]}
        </button>
      ))}
      {activeTool !== null && (
        <button type="button" className="drawing-tool-button drawing-tool-cancel" onClick={() => controller.setActiveTool(null)}>
          Cancel
        </button>
      )}
      <button type="button" className="drawing-tool-button" onClick={() => controller.clear()}>
        Clear drawings
      </button>
    </div>
  );
}
