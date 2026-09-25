import type { ReactNode } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

/** A real .xlsx, not CSV — CSV-in-Excel on Windows mangled the en-dash in
 * shift labels (Excel guesses ANSI encoding without a UTF-8 BOM) and left
 * every date column showing "####" (too narrow for Excel's auto-applied
 * date format, and CSV carries no column-width metadata to fix that).
 * .xlsx has neither problem, and skips the "possible data loss" banner.
 *
 * Security note: `xlsx` (SheetJS) has open advisories, but they're all in
 * the *parsing* path (XLSX.read/readFile on an untrusted file). This module
 * only ever builds and writes a workbook from our own data — it never
 * parses one — so that code path is never reached here.
 *
 * `pageBreakBeforeRowIndexes` (0-based into `rows`, e.g. "the first row of
 * each new employee's block") inserts real manual page breaks into the
 * printed Excel output — something the free `xlsx` (SheetJS) build has no
 * documented API for. Every OTHER caller omits this and is byte-for-byte
 * unaffected: the whole jszip patch path is skipped, same XLSX.writeFile()
 * call as before. When it IS passed, the row-break XML (<rowBreaks>) is
 * spliced into xl/worksheets/sheet1.xml immediately after </sheetData> —
 * verified against real ECMA-376 CT_Worksheet element order, and this is
 * safe for every current/possible caller (all of which pass a flat
 * headers+rows table with no merged cells, hyperlinks, or autofilter — the
 * only things that would legitimately need to sit between sheetData and
 * rowBreaks) — then the patched zip is re-saved by hand instead of via
 * XLSX.writeFile(), which has no patch/re-zip hook of its own. */
export async function downloadExcel(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
  pageBreakBeforeRowIndexes?: number[]
) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Size each column to its widest cell (header or data) so nothing renders
  // as Excel's "####" too-narrow-for-a-date placeholder. Capped so one long
  // outlier (e.g. a reason/note field) doesn't blow out the whole sheet.
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const outName = filename.replace(/\.csv$/i, '') + '.xlsx';

  const breaksAfterHeaderRow = (pageBreakBeforeRowIndexes ?? [])
    // Never break before the very first data row — that would just waste a
    // blank leading page, same reasoning as the print CSS's own version of
    // this.
    .filter(i => i > 0);
  if (breaksAfterHeaderRow.length === 0) {
    XLSX.writeFile(wb, outName);
    return;
  }

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const zip = await JSZip.loadAsync(buf);
  const sheetPath = 'xl/worksheets/sheet1.xml';
  const sheetFile = zip.file(sheetPath);
  const xml = sheetFile ? await sheetFile.async('string') : null;
  if (xml && xml.includes('</sheetData>')) {
    // aoa_to_sheet([headers, ...rows]) puts headers on row 1 (1-based), so
    // rows[i] lands on Excel row i+2. A break BEFORE that row is a <brk>
    // AFTER the row before it: id = (i+2) - 1.
    const brks = breaksAfterHeaderRow.map(i => `<brk id="${i + 1}" max="16383" man="1"/>`).join('');
    const rowBreaksXml = `<rowBreaks count="${breaksAfterHeaderRow.length}" manualBreakCount="${breaksAfterHeaderRow.length}">${brks}</rowBreaks>`;
    zip.file(sheetPath, xml.replace('</sheetData>', '</sheetData>' + rowBreaksXml));
  }
  // If sheet1.xml wasn't found or didn't look like we expected, the zip is
  // re-saved unpatched below rather than thrown away — a plain file with no
  // page breaks is a far better failure mode than no download at all.

  const patched = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(patched);
  const a = document.createElement('a');
  a.href = url;
  a.download = outName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Print button doubles as "Save as PDF" — every browser's print dialog
 * offers that as a destination, so no PDF-generation library is needed.
 * Pairs with the print:hidden / print:overflow-visible classes on AppShell
 * and each table's own scroll wrapper. */
export default function TableExportBar({
  onExportCsv,
  leading,
  disabled,
}: {
  onExportCsv: () => void;
  /** Optional control(s) rendered just left of the Print button — e.g. a
   * report-settings menu. */
  leading?: ReactNode;
  /** True while the table's own data is still loading/recomputing — both
   * buttons capture whatever's currently in the DOM (window.print()) or in
   * the caller's `rows` closure (onExportCsv) with no wait of their own, so
   * clicking mid-fetch silently exports a stale or half-loaded table. Pass
   * the caller's existing loading flag through here instead of adding a
   * wait inside this component, since only the caller knows when its data
   * is actually settled. */
  disabled?: boolean;
}) {
  return (
    <div className="ml-auto flex items-center gap-2 print:hidden">
      {leading}
      <button
        onClick={() => window.print()}
        disabled={disabled}
        title={disabled ? 'Report is still loading — wait for it to finish before printing' : undefined}
        className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
      >
        🖨 Print / Save PDF
      </button>
      <button
        onClick={onExportCsv}
        disabled={disabled}
        title={disabled ? 'Report is still loading — wait for it to finish before exporting' : undefined}
        className="flex items-center gap-1 rounded-md border border-accent bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent shadow-sm transition-colors hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-accent/5 disabled:hover:text-accent"
      >
        ⭳ Export Excel
      </button>
    </div>
  );
}
