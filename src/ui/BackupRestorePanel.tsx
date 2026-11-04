import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { DrawingController } from '../chart/DrawingController';
import { drawingStorageKey, saveDrawings } from '../chart/DrawingStorage';
import type { Timeframe } from '../types/marketData';
import { BACKUP_VERSION, validateDrawingBackup, validateMarketDatabase } from '../data/BackupFormat';
import { exportDrawingDatabase, importDrawingDatabase } from '../data/DrawingBackupStorage';
import { parseSpreadsheet } from '../data/SpreadsheetImport';
import type { DSEProvider } from '../data/DSEProvider';

type Dialog = 'export' | 'import' | 'market-import' | null;
type Props = {
  provider: DSEProvider;
  controller: DrawingController | null;
  symbol: string;
  timeframe: Timeframe;
  onMarketDataImported: () => Promise<void>;
};

async function downloadJson(filename: string, data: unknown): Promise<'shared' | 'downloaded'> {
  const content = JSON.stringify(data, null, 2);
  if (Capacitor.isNativePlatform()) {
    // Android WebView does not implement the Web Share API or a default download listener.
    // Write the JSON into the app cache, then hand its native file URI to Android's share sheet.
    const saved = await Filesystem.writeFile({
      path: filename,
      data: content,
      encoding: Encoding.UTF8,
      directory: Directory.Cache,
      recursive: true,
    });
    const capability = await Share.canShare();
    if (!capability.value) throw new Error('مشاركة الملفات غير متاحة على هذا الجهاز.');
    await Share.share({
      title: filename,
      dialogTitle: 'تصدير نسخة TradingPro الاحتياطية',
      files: [saved.uri],
    });
    return 'shared';
  }
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

export function BackupRestorePanel({ provider, controller, symbol, timeframe, onMarketDataImported }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [exportMarket, setExportMarket] = useState(true);
  const [exportDrawings, setExportDrawings] = useState(true);
  const [marketMode, setMarketMode] = useState<'update' | 'replace'>('update');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const marketInput = useRef<HTMLInputElement>(null);
  const drawingsInput = useRef<HTMLInputElement>(null);

  const close = () => { if (!busy) setDialog(null); };
  const exportSelected = async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const exportedAt = new Date().toISOString();
    let marketBackup: unknown;
    let drawingBackup: unknown;
    if (exportMarket) {
      const symbols = Object.fromEntries(Object.entries(provider.exportDatabase()).map(([key, rows]) => [
        key, rows.map(({ date, open, high, low, close, volume, valueTraded }) =>
          ({ date, open, high, low, close, volume, valueTraded })),
      ]));
      marketBackup = { format: 'tradingpro-market-database', version: BACKUP_VERSION, exportedAt, symbols };
    }
    if (exportDrawings) {
      const backup = exportDrawingDatabase(window.localStorage);
      // Include the active chart's latest state even before its debounce persistence completes.
      if (controller !== null) {
        const items = controller.export();
        const active = backup.drawings.find((group) => group.symbol === symbol && group.timeframe === timeframe);
        if (active) active.items = items;
        else backup.drawings.push({ symbol, timeframe, items });
      }
      drawingBackup = backup;
    }
    let filename: string;
    let payload: unknown;
    if (exportMarket && exportDrawings) {
      filename = `tradingpro-backup-${stamp}.json`;
      payload = { format: 'tradingpro-complete-backup', version: BACKUP_VERSION, exportedAt, marketData: marketBackup, drawings: drawingBackup };
    } else if (exportMarket) {
      filename = `tradingpro-market-database-${stamp}.json`;
      payload = marketBackup;
    } else {
      filename = `tradingpro-drawings-${stamp}.json`;
      payload = drawingBackup;
    }
    try {
      const delivery = await downloadJson(filename, payload);
      setDialog(null);
      setMessage({ text: delivery === 'shared'
        ? 'تم فتح قائمة المشاركة. اختر حفظ الملف في التنزيلات أو في موقع آمن.'
        : 'تم تنزيل ملف النسخة الاحتياطية. احفظه في مكان آمن خارج التطبيق.', error: false });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  };

  const importMarketFile = async (file: File) => {
    setBusy(true); setMessage(null);
    try {
      let backup;
      if (file.name.toLowerCase().endsWith('.json') || file.type.includes('json')) {
        const parsed: unknown = JSON.parse(await file.text());
        const source = typeof parsed === 'object' && parsed !== null && 'format' in parsed && parsed.format === 'tradingpro-complete-backup'
          ? (parsed as { marketData?: unknown }).marketData : parsed;
        backup = validateMarketDatabase(source);
      } else {
        const parsed = await parseSpreadsheet(file);
        backup = validateMarketDatabase({
          format: 'tradingpro-market-database', version: BACKUP_VERSION,
          exportedAt: new Date().toISOString(), symbols: parsed,
        });
      }
      const result = provider.importDatabase(backup.symbols, marketMode);
      await onMarketDataImported();
      setDialog(null);
      setMessage({
        text: marketMode === 'update'
          ? `اكتمل التحديث: أُضيفت ${result.added} شمعة جديدة، وتُركت ${result.kept} شمعة موجودة دون تعديل. الرموز: ${result.symbols.join('، ')}.`
          : `تم استبدال قاعدة البيانات بالملف المحدد. عدد الشموع المستوردة: ${result.added}.`,
        error: false,
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
      if (marketInput.current) marketInput.current.value = '';
    }
  };

  const importDrawingsFile = async (file: File) => {
    setBusy(true); setMessage(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const source = typeof parsed === 'object' && parsed !== null && 'format' in parsed && parsed.format === 'tradingpro-complete-backup'
        ? (parsed as { drawings?: unknown }).drawings : parsed;
      const backup = validateDrawingBackup(source);
      importDrawingDatabase(window.localStorage, backup.drawings);
      const active = backup.drawings.find((group) => group.symbol === symbol && group.timeframe === timeframe);
      if (active && controller) {
        controller.clear();
        controller.import(active.items);
        saveDrawings(window.localStorage, drawingStorageKey(symbol, timeframe), controller.export());
      }
      setDialog(null);
      setMessage({ text: `تم استيراد الرسومات بنجاح. عدد مجموعات الأسهم والأطر الزمنية: ${backup.drawings.length}.`, error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
      if (drawingsInput.current) drawingsInput.current.value = '';
    }
  };

  return (
    <div className="backup-tools">
      <span className="backup-divider" aria-hidden="true" />
      <button type="button" className="drawing-tool-button backup-action" aria-label="تصدير البيانات" title="تصدير البيانات" onClick={() => { setMessage(null); setDialog('export'); }}>
        <span aria-hidden="true">⇧</span>
      </button>
      <button type="button" className="drawing-tool-button backup-action" aria-label="استيراد البيانات" title="استيراد البيانات" onClick={() => { setMessage(null); setDialog('import'); }}>
        <span aria-hidden="true">⇩</span>
      </button>
      {message && <div className={message.error ? 'backup-message error' : 'backup-message'} role="status">{message.text}</div>}
      <input ref={marketInput} type="file" hidden accept=".json,.xlsx,.xls,.xlsm,.xlsb,.csv,.tsv,.txt,.xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importMarketFile(file); }} />
      <input ref={drawingsInput} type="file" hidden accept=".json,.txt,application/json,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDrawingsFile(file); }} />

      {dialog && (
        <div className="backup-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="backup-modal" role="dialog" aria-modal="true"
            aria-labelledby="backup-dialog-title">
            <header className="backup-modal-header">
              <h2 id="backup-dialog-title">
                {dialog === 'export' ? 'تصدير البيانات' : dialog === 'import' ? 'استيراد البيانات' : 'استيراد بيانات الأسهم'}
              </h2>
              <button type="button" className="backup-close" aria-label="إغلاق" disabled={busy} onClick={close}>×</button>
            </header>

            {dialog === 'export' && (
              <div className="backup-modal-body">
                <p>اختر أنواع البيانات التي تريد حفظ نسخة منها في ملفات JSON مستقلة.</p>
                <label className="backup-option">
                  <span>بيانات الأسهم والشموع</span>
                  <input type="checkbox" role="switch" checked={exportMarket} onChange={(event) => setExportMarket(event.target.checked)} />
                </label>
                <label className="backup-option">
                  <span>الأشكال المرسومة</span>
                  <input type="checkbox" role="switch" checked={exportDrawings} onChange={(event) => setExportDrawings(event.target.checked)} />
                </label>
                <button type="button" className="backup-primary" disabled={!exportMarket && !exportDrawings} onClick={exportSelected}>تصدير</button>
              </div>
            )}

            {dialog === 'import' && (
              <div className="backup-modal-body">
                <p>اختر نوع البيانات التي تريد استعادتها.</p>
                <button type="button" className="backup-choice" onClick={() => setDialog('market-import')}>استيراد بيانات الأسهم</button>
                <button type="button" className="backup-choice" onClick={() => { setDialog(null); drawingsInput.current?.click(); }}>استيراد الأشكال المرسومة</button>
              </div>
            )}

            {dialog === 'market-import' && (
              <div className="backup-modal-body">
                <p>حدد كيفية التعامل مع الملف الذي ستختاره، ثم اضغط تأكيد لاختياره.</p>
                <label className="backup-radio">
                  <input type="radio" name="market-import-mode" checked={marketMode === 'update'} onChange={() => setMarketMode('update')} />
                  <span><strong>تحديث البيانات</strong><small>إضافة التواريخ غير الموجودة فقط، دون تعديل أي شمعة موجودة.</small></span>
                </label>
                <label className="backup-radio">
                  <input type="radio" name="market-import-mode" checked={marketMode === 'replace'} onChange={() => setMarketMode('replace')} />
                  <span><strong>جلب قاعدة بيانات</strong><small>استبدال قاعدة البيانات المحلية بالبيانات الموجودة في الملف.</small></span>
                </label>
                <button type="button" className="backup-primary" disabled={busy} onClick={() => marketInput.current?.click()}>{busy ? 'جارٍ الاستيراد…' : 'تأكيد واختيار الملف'}</button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
