'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Sheet, { type SheetColumn } from '@/components/kpi/Sheet';
import type { ColumnRole } from '@/lib/serviceImport';

export type PastImport = { id: string; file_name: string; rows_read: number; rows_imported: number; first_date: string | null; last_date: string | null; created_at: string };

type Rec = { id: string; employee_id: string; performed_on: string; service: string | null; minutes: number | null; customer_key: string | null; customer_name?: string | null; customer_phone?: string | null };

/** How many rows one request asks for (the database sends at most 1,000 at a time). */
const PAGE = 1000;

/** An earlier import, opened as a sheet in a pop-up: the rows it brought in, as they were kept (the file itself is not kept), with
 * each customer's name and phone number. Rows imported before names were kept show the customer ID if there was one, else nothing. */
export default function ImportSheetDialog({ item, people, dayText, heading, onClose, onRemove }: {
  item: PastImport;
  people: { id: string; name: string }[];
  dayText: (isoDay: string) => string;
  /** The column heading for a kind of column (what this company calls the customer, for one). */
  heading: (role: ColumnRole) => string;
  onClose: () => void;
  /** Asks, then removes the import: says whether it is gone, and why not when the database refused. */
  onRemove: () => Promise<{ removed: boolean; error: string }>;
}) {
  const [records, setRecords] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Read the import's rows a page at a time, oldest service first (the id breaks ties, so no row is missed or read twice).
  useEffect(() => {
    let live = true;
    (async () => {
      const all: Rec[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase
          .from('service_records')
          .select('*')
          .eq('import_id', item.id)
          .order('performed_on', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!live) return;
        if (e) {
          setError(`Could not load the rows: ${e.message}`);
          break;
        }
        const part = (data as Rec[] | null) ?? [];
        all.push(...part);
        setRecords(all.slice());
        if (part.length < PAGE) break;
      }
      if (live) setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [item.id]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A question being asked on top (Remove import) takes Escape first.
      if (e.key === 'Escape' && !document.querySelector('[role=alertdialog]')) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const names = useMemo(() => new Map(people.map(p => [p.id, p.name])), [people]);
  const columns: SheetColumn[] = useMemo(
    () => [
      { header: heading('date'), width: 150 },
      { header: heading('employee'), width: 200 },
      { header: heading('service'), width: 230 },
      { header: heading('minutes'), width: 210, align: 'right' },
      { header: heading('customerName'), width: 200 },
      { header: heading('customerPhone'), width: 160 },
    ],
    [heading]
  );
  const rows = useMemo(
    () => records.map(r => [dayText(r.performed_on), names.get(r.employee_id) ?? '–', r.service ?? '', r.minutes == null ? '' : String(r.minutes), r.customer_name ?? (r.customer_key?.startsWith('c:') ? r.customer_key.slice(2) : ''), r.customer_phone ?? '']),
    [records, names, dayText]
  );

  async function remove() {
    if (removing) return;
    setRemoving(true);
    setError('');
    const r = await onRemove();
    if (r.error) setError(r.error);
    if (!r.removed) setRemoving(false);
  }

  const range = item.first_date && item.last_date ? (item.first_date === item.last_date ? dayText(item.first_date) : `${dayText(item.first_date)} to ${dayText(item.last_date)}`) : '';

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-sheet-title"
        onClick={e => e.stopPropagation()}
        className="my-auto w-full max-w-[1080px] overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id="import-sheet-title" className="m-0 break-all text-lg font-extrabold text-ink">
              {item.file_name}
            </h2>
            <div className="mt-0.5 text-[13px] text-slate-600">
              Imported {dayText(item.created_at.slice(0, 10))}
              {range ? ` · ${range}` : ''}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={remove} disabled={removing} className="min-h-[40px] rounded-[10px] px-3 text-sm font-bold text-critical-text hover:bg-critical-bg disabled:opacity-50">
              Remove import
            </button>
            <button ref={closeButton} type="button" onClick={onClose} className="min-h-[40px] rounded-[10px] border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50">
              Close
            </button>
          </div>
        </div>

        <Sheet label={`Services imported from ${item.file_name}`} columns={columns} rows={rows} loading={loading} maxHeight="min(58vh, 540px)" />

        {error && (
          <p role="alert" className="m-0 border-t border-slate-300 px-5 py-2.5 text-sm font-semibold text-critical-text">
            {error}
          </p>
        )}
        <ul aria-label="Sheet status" className="m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-300 bg-slate-100 px-5 py-2 text-[12.5px] text-slate-700">
          <li>
            {loading ? 'Loading… ' : ''}
            <b className="tabular-nums text-ink">{records.length}</b> {records.length === 1 ? 'row' : 'rows'}
            {loading && item.rows_imported > 0 ? ` of ${item.rows_imported}` : ''}
          </li>
        </ul>
      </div>
    </div>
  );
}
