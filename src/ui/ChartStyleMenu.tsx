import { useEffect, useMemo, useState } from 'react';
import type { ChartController } from '../chart/ChartController';
import type { IndicatorWorkspace } from '../indicators/IndicatorWorkspace';
import { Dropdown } from './Dropdown';
import { useWorkspaceSnapshot } from './useWorkspaceSnapshot';

type Options = Record<string, string | number | boolean>;
const STORAGE_KEY = 'tradingpro.series-style-settings.v1';
function readSaved(): Record<string, Options> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, Options> : {};
  } catch { return {}; }
}
const labelFor = (id: string) => id === 'price' ? 'الشموع اليابانية' : id === 'price-line' ? 'الخط البياني للسعر' : id.startsWith('sma:') ? `SMA · ${id.slice(4)}` : id.toUpperCase();
const defaultLineColor = (id: string) => id === 'price-line' ? '#5aa9e6' : id.startsWith('sma:') ? '#f2c14e' : '#d6b25e';

export function ChartStyleMenu({ controller, workspace }: { controller: ChartController | null; workspace: IndicatorWorkspace | null }) {
  const snapshot = useWorkspaceSnapshot(workspace);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('price');
  const [saved, setSaved] = useState<Record<string, Options>>(readSaved);
  const series = useMemo(() => controller?.isMounted ? controller.series.list() : [], [controller, snapshot]);
  const selected = series.find((item) => item.id === target) ?? series.find((item) => item.id === 'price');
  const options = saved[target] ?? {};
  const update = (patch: Options) => {
    setSaved((current) => {
      const next = { ...current, [target]: { ...(current[target] ?? {}), ...patch } };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
      return next;
    });
  };
  useEffect(() => {
    if (controller === null || !controller.isMounted) return;
    for (const item of controller.series.list()) {
      const config = saved[item.id];
      if (config !== undefined) controller.series.get(item.id)?.applyOptions(config as never);
    }
  }, [controller, snapshot, saved]);
  const isCandle = selected?.type === 'Candlestick';
  const isLine = selected?.type === 'Line';
  return (
    <Dropdown id="menu-chart-style" label="المظهر" open={open} onOpenChange={setOpen} width={330}>
      {controller === null || selected === undefined ? <p className="menu-empty">تظهر إعدادات السلاسل بعد تحميل الرسم.</p> : (
        <div className="chart-style-menu">
          <label className="chart-style-target">السلسلة
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              {series.map((item) => <option key={item.id} value={item.id}>{labelFor(item.id)}</option>)}
            </select>
          </label>
          {isLine && <>
            <label className="chart-style-row">لون الخط <input aria-label="لون الخط" type="color" value={String(options.color ?? defaultLineColor(target))} onChange={(event) => update({ color: event.target.value })} /></label>
            <label className="chart-style-row">سماكة الخط <output>{Number(options.lineWidth ?? 2)} px</output><input type="range" min="1" max="4" step="1" value={Number(options.lineWidth ?? 2)} onChange={(event) => update({ lineWidth: Number(event.target.value) })} /></label>
            <label className="chart-style-row">نمط الخط
              <select value={Number(options.lineStyle ?? 0)} onChange={(event) => update({ lineStyle: Number(event.target.value) })}>
                <option value="0">متصل</option><option value="1">منقّط</option><option value="2">متقطع</option><option value="3">متقطع طويل</option>
              </select>
            </label>
            <label className="chart-style-row">علامة التقاطع <input type="checkbox" checked={Boolean(options.crosshairMarkerVisible ?? true)} onChange={(event) => update({ crosshairMarkerVisible: event.target.checked })} /></label>
          </>}
          {isCandle && <>
            <label className="chart-style-row">لون الشمعة الصاعدة <input type="color" value={String(options.upColor ?? '#26a69a')} onChange={(event) => update({ upColor: event.target.value, wickUpColor: event.target.value, borderUpColor: event.target.value })} /></label>
            <label className="chart-style-row">لون الشمعة الهابطة <input type="color" value={String(options.downColor ?? '#ef5350')} onChange={(event) => update({ downColor: event.target.value, wickDownColor: event.target.value, borderDownColor: event.target.value })} /></label>
            <label className="chart-style-row">إظهار الحدود <input type="checkbox" checked={Boolean(options.borderVisible ?? false)} onChange={(event) => update({ borderVisible: event.target.checked })} /></label>
            <label className="chart-style-row">إظهار الفتائل <input type="checkbox" checked={Boolean(options.wickVisible ?? true)} onChange={(event) => update({ wickVisible: event.target.checked })} /></label>
          </>}
          {(isLine || isCandle) && <>
            <label className="chart-style-row">خط السعر <input type="checkbox" checked={Boolean(options.priceLineVisible ?? false)} onChange={(event) => update({ priceLineVisible: event.target.checked })} /></label>
            <label className="chart-style-row">آخر قيمة على المحور <input type="checkbox" checked={Boolean(options.lastValueVisible ?? true)} onChange={(event) => update({ lastValueVisible: event.target.checked })} /></label>
          </>}
          {!isLine && !isCandle && <p className="menu-empty">إعدادات هذه السلسلة غير مدعومة في لوحة الخطوط والشموع حالياً.</p>}
        </div>
      )}
    </Dropdown>
  );
}
