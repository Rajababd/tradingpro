import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DrawingController } from '../chart/DrawingController';

const TOOL_LABELS: Record<string, string> = {
  'trend-line': 'خط الاتجاه',
  'horizontal-line': 'خط أفقي',
  'fib-retracement': 'تصحيح فيبوناتشي',
};
const TOOL_GLYPHS: Record<string, string> = {
  'trend-line': '／',
  'horizontal-line': '━',
  'fib-retracement': '⌁',
};

function FloatingButton({ position, onClick }: {
  position: { x: number; y: number };
  onClick: () => void;
}) {
  const style: CSSProperties = {
    position: 'fixed',
    left: Math.max(8, Math.min(position.x - 18, window.innerWidth - 44)),
    top: Math.max(8, position.y - 46),
    zIndex: 60,
  };
  return (
    <button
      type="button"
      className="drawing-floating-settings-trigger"
      style={style}
      aria-label="فتح إعدادات الشكل المرسوم"
      title="إعدادات الشكل"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
    >
      ⚙
    </button>
  );
}

/** Compact drawing toolbar; selection exposes only a small floating settings trigger. */
export function DrawingToolbar({ controller }: { controller: DrawingController | null }) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (controller === null) {
      setActiveTool(null);
      setSettingsOpen(false);
      return;
    }
    const refresh = (event?: unknown) => {
      setActiveTool(controller.activeTool);
      void event;
      setRevision((value) => value + 1);
    };
    const unsubscribers = [
      controller.on('tool:changed', refresh),
      controller.on('drawing:selected', () => { setSettingsOpen(false); refresh(); }),
      controller.on('drawing:deselected', () => { setSettingsOpen(false); refresh(); }),
      controller.on('drawing:updated', refresh),
      controller.on('drawing:removed', () => { setSettingsOpen(false); refresh(); }),
      controller.on('drawing:cleared', () => { setSettingsOpen(false); refresh(); }),
    ];
    refresh();
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [controller]);

  const available = controller?.tools.filter((tool) => tool.type in TOOL_LABELS) ?? Object.keys(TOOL_LABELS).map((type) => ({
    type,
    requiredAnchors: type === 'horizontal-line' ? 1 : 2,
  }));
  const selected = controller?.selectedDrawing ?? null;
  const position = selected ? controller?.getSelectedScreenPosition() ?? null : null;
  const style = selected?.style;
  const options = selected?.options;
  const isTrendLine = selected?.type === 'trend-line';
  const trendOptions = isTrendLine ? selected?.trendLineOptions : undefined;

  const panelPosition: CSSProperties | undefined = position ? {
    position: 'fixed',
    left: Math.max(8, Math.min(position.x + 24, window.innerWidth - 286)),
    top: Math.max(8, Math.min(position.y - 20, window.innerHeight - 360)),
    zIndex: 61,
  } : undefined;

  return (
    <>
      <div className="drawing-toolbar" role="group" aria-label="Drawing tools">
          <span className="sr-only">Draw</span>
          {available.map((tool) => (
            <button
              key={tool.type}
              type="button"
              className="drawing-tool-button"
              aria-label={TOOL_LABELS[tool.type]}
              aria-pressed={activeTool === tool.type}
              disabled={controller === null}
              title={`${TOOL_LABELS[tool.type]} · ${tool.requiredAnchors} click${tool.requiredAnchors === 1 ? '' : 's'}`}
              onClick={() => {
                setSettingsOpen(false);
                controller?.setActiveTool(activeTool === tool.type ? null : tool.type);
              }}
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

      {selected && position && controller && activeTool === null && (
        <FloatingButton position={position} onClick={() => setSettingsOpen((open) => !open)} />
      )}

      {settingsOpen && selected && controller && panelPosition && (
        <section
          className="drawing-settings-panel"
          style={panelPosition}
          aria-label={`إعدادات ${TOOL_LABELS[selected.type] ?? selected.type}`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header className="drawing-settings-header">
            <strong>إعدادات {TOOL_LABELS[selected.type] ?? selected.type}</strong>
            <button type="button" className="drawing-settings-close" aria-label="إغلاق الإعدادات" onClick={() => setSettingsOpen(false)}>×</button>
          </header>

          <div className="drawing-settings-body">
            <label className="drawing-setting-row">
              <span>لون الخط</span>
              <input aria-label="لون الخط" type="color" value={style?.lineColor ?? '#2962ff'} onChange={(event) => controller.updateSelected({ style: { lineColor: event.target.value } })} />
            </label>
            <label className="drawing-setting-row">
              <span>سماكة الخط</span>
              <select aria-label="سماكة الخط" value={String(style?.lineWidth ?? 2)} onChange={(event) => controller.updateSelected({ style: { lineWidth: Number(event.target.value) } })}>
                {[1, 2, 3, 4, 5].map((width) => <option key={width} value={width}>{width}px</option>)}
              </select>
            </label>
            <label className="drawing-setting-row">
              <span>قفل الشكل</span>
              <input aria-label="قفل الشكل" type="checkbox" checked={options?.locked === true} onChange={(event) => controller.updateSelected({ options: { locked: event.target.checked } })} />
            </label>

            {isTrendLine && (
              <>
                <div className="drawing-settings-divider" />
                <strong className="drawing-settings-subtitle">إعدادات خط الاتجاه</strong>
                <label className="drawing-setting-row">
                  <span>تحويل إلى شعاع (Ray)</span>
                  <input aria-label="تحويل خط الاتجاه إلى شعاع" type="checkbox" checked={options?.extendRight === true} onChange={(event) => controller.updateSelected({ options: { extendRight: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>تمديد الاتجاهين</span>
                  <input aria-label="تمديد خط الاتجاه بالاتجاهين" type="checkbox" checked={options?.extendLeft === true && options?.extendRight === true} onChange={(event) => controller.updateSelected({ options: { extendLeft: event.target.checked, extendRight: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>إظهار الزاوية</span>
                  <input aria-label="إظهار زاوية خط الاتجاه" type="checkbox" checked={trendOptions?.showAngle === true} onChange={(event) => controller.updateSelected({ trendLineOptions: { showAngle: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>التغير السعري</span>
                  <input aria-label="إظهار التغير السعري" type="checkbox" checked={trendOptions?.showPriceChange === true} onChange={(event) => controller.updateSelected({ trendLineOptions: { showPriceChange: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>التغير المئوي</span>
                  <input aria-label="إظهار التغير المئوي" type="checkbox" checked={trendOptions?.showPercentChange === true} onChange={(event) => controller.updateSelected({ trendLineOptions: { showPercentChange: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>عدد الشموع</span>
                  <input aria-label="إظهار عدد الشموع" type="checkbox" checked={trendOptions?.showBars === true} onChange={(event) => controller.updateSelected({ trendLineOptions: { showBars: event.target.checked } })} />
                </label>
              </>
            )}

            {selected.type === 'horizontal-line' && (
              <>
                <div className="drawing-settings-divider" />
                <strong className="drawing-settings-subtitle">إعدادات الخط الأفقي</strong>
                <label className="drawing-setting-row">
                  <span>إظهار السعر</span>
                  <input aria-label="إظهار سعر الخط الأفقي" type="checkbox" checked={selected.horizontalLineOptions?.showPrice !== false} onChange={(event) => controller.updateSelected({ horizontalLineOptions: { showPrice: event.target.checked } })} />
                </label>
              </>
            )}

            {selected.type === 'fib-retracement' && (
              <>
                <div className="drawing-settings-divider" />
                <strong className="drawing-settings-subtitle">إعدادات فيبوناتشي</strong>
                <label className="drawing-setting-row">
                  <span>إظهار الأسعار</span>
                  <input aria-label="إظهار أسعار فيبوناتشي" type="checkbox" checked={selected.fibOptions?.showPrices !== false} onChange={(event) => controller.updateSelected({ fibOptions: { showPrices: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>إظهار النسب</span>
                  <input aria-label="إظهار نسب فيبوناتشي" type="checkbox" checked={selected.fibOptions?.showPercentages !== false} onChange={(event) => controller.updateSelected({ fibOptions: { showPercentages: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>تمديد المستويات</span>
                  <input aria-label="تمديد مستويات فيبوناتشي" type="checkbox" checked={selected.fibOptions?.extendLines === true} onChange={(event) => controller.updateSelected({ fibOptions: { extendLines: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>عكس الاتجاه</span>
                  <input aria-label="عكس اتجاه فيبوناتشي" type="checkbox" checked={selected.fibOptions?.reverseDirection === true} onChange={(event) => controller.updateSelected({ fibOptions: { reverseDirection: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>المستويات</span>
                  <input aria-label="مستويات فيبوناتشي" type="text" value={selected.fibOptions?.levels?.join(', ') ?? '0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618'} onChange={(event) => controller.updateSelected({ fibOptions: { levels: event.target.value.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value)) } })} />
                </label>
              </>
            )}

            <button type="button" className="drawing-delete-button" onClick={() => {
              controller.removeSelected();
              setSettingsOpen(false);
            }}>حذف الشكل المرسوم</button>
          </div>
        </section>
      )}
    </>
  );
}
