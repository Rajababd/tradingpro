import { useEffect, useState } from 'react';
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

const DASHES = [
  { label: 'متصل', value: 'solid' },
  { label: 'متقطع', value: 'dashed' },
  { label: 'منقط', value: 'dotted' },
] as const;

function dashName(value: readonly number[] | undefined): string {
  if (!value?.length) return 'solid';
  if (value.length === 2 && value[0] === 6 && value[1] === 4) return 'dashed';
  return 'dotted';
}
function dashPattern(value: string): number[] {
  return value === 'dashed' ? [6, 4] : value === 'dotted' ? [2, 3] : [];
}

/** Compact drawing toolbar with context-sensitive settings for the selected drawing. */
export function DrawingToolbar({ controller }: { controller: DrawingController | null }) {
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (controller === null) {
      setActiveTool(null);
      return;
    }
    const refresh = () => {
      setActiveTool(controller.activeTool);
      setRevision((value) => value + 1);
    };
    const unsubscribers = [
      controller.on('tool:changed', refresh),
      controller.on('drawing:selected', refresh),
      controller.on('drawing:deselected', refresh),
      controller.on('drawing:updated', refresh),
      controller.on('drawing:removed', refresh),
      controller.on('drawing:cleared', refresh),
    ];
    refresh();
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [controller]);

  const available = controller?.tools.filter((tool) => tool.type in TOOL_LABELS) ?? Object.keys(TOOL_LABELS).map((type) => ({
    type,
    requiredAnchors: type === 'horizontal-line' ? 1 : 2,
  }));
  const selected = controller?.selectedDrawing ?? null;
  const style = selected?.style;
  const options = selected?.options;
  const isTrendLine = selected?.type === 'trend-line';
  const trendOptions = isTrendLine ? selected?.trendLineOptions : undefined;

  return (
    <div className="drawing-tools-shell">
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

      {selected && controller && (
        <section className="drawing-settings-panel" aria-label="إعدادات الشكل المرسوم">
          <header className="drawing-settings-header">
            <strong>إعدادات {TOOL_LABELS[selected.type] ?? selected.type}</strong>
            <button type="button" className="drawing-settings-close" aria-label="إلغاء التحديد" onClick={() => {
              // Clicking the chart background or Escape also deselects; expose a small close action here.
              controller.deselectAll();
            }}>×</button>
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
              <span>نمط الخط</span>
              <select aria-label="نمط الخط" value={dashName(style?.lineDash)} onChange={(event) => controller.updateSelected({ style: { lineDash: dashPattern(event.target.value) } })}>
                {DASHES.map((dash) => <option key={dash.value} value={dash.value}>{dash.label}</option>)}
              </select>
            </label>
            <label className="drawing-setting-row">
              <span>لون التسمية</span>
              <input aria-label="لون التسمية" type="color" value={style?.labelColor ?? '#2962ff'} onChange={(event) => controller.updateSelected({ style: { labelColor: event.target.value } })} />
            </label>
            <label className="drawing-setting-row">
              <span>خط التسمية</span>
              <input aria-label="خط التسمية" type="text" value={style?.labelFont ?? '12px sans-serif'} onChange={(event) => controller.updateSelected({ style: { labelFont: event.target.value } })} />
            </label>
            <label className="drawing-setting-row">
              <span>إظهار التسميات</span>
              <input aria-label="إظهار التسميات" type="checkbox" checked={style?.showLabels ?? true} onChange={(event) => controller.updateSelected({ style: { showLabels: event.target.checked } })} />
            </label>
            <label className="drawing-setting-row">
              <span>لون التعبئة</span>
              <input aria-label="لون التعبئة" type="color" value={(style?.fillColor ?? 'rgba(41, 98, 255, 0.1)').startsWith('#') ? style!.fillColor : '#2962ff'} onChange={(event) => controller.updateSelected({ style: { fillColor: event.target.value } })} />
            </label>
            <label className="drawing-setting-row">
              <span>شفافية التعبئة</span>
              <input aria-label="شفافية التعبئة" type="range" min="0" max="1" step="0.05" value={style?.fillOpacity ?? 0.1} onChange={(event) => controller.updateSelected({ style: { fillOpacity: Number(event.target.value) } })} />
            </label>

            <div className="drawing-settings-divider" />
            <label className="drawing-setting-row">
              <span>إظهار الشكل</span>
              <input aria-label="إظهار الشكل" type="checkbox" checked={options?.visible !== false} onChange={(event) => controller.updateSelected({ options: { visible: event.target.checked } })} />
            </label>
            <label className="drawing-setting-row">
              <span>قفل الشكل</span>
              <input aria-label="قفل الشكل" type="checkbox" checked={options?.locked === true} onChange={(event) => controller.updateSelected({ options: { locked: event.target.checked } })} />
            </label>
            {!isTrendLine && (
              <>
                <label className="drawing-setting-row">
                  <span>تمديد لليسار</span>
                  <input aria-label="تمديد لليسار" type="checkbox" checked={options?.extendLeft === true} onChange={(event) => controller.updateSelected({ options: { extendLeft: event.target.checked } })} />
                </label>
                <label className="drawing-setting-row">
                  <span>تمديد لليمين</span>
                  <input aria-label="تمديد لليمين" type="checkbox" checked={options?.extendRight === true} onChange={(event) => controller.updateSelected({ options: { extendRight: event.target.checked } })} />
                </label>
              </>
            )}
            <label className="drawing-setting-row">
              <span>ترتيب الرسم</span>
              <input aria-label="ترتيب الرسم" type="number" min="-100" max="100" value={options?.zIndex ?? 0} onChange={(event) => controller.updateSelected({ options: { zIndex: Number(event.target.value) } })} />
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
            <button type="button" className="drawing-delete-button" onClick={() => controller.removeSelected()}>حذف الشكل المرسوم</button>
          </div>
        </section>
      )}
    </div>
  );
}
