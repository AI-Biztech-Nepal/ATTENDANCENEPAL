'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { DOCUMENTS_BUCKET, DOCUMENT_TYPES, formatBytes, type EmployeeDocument } from '@/lib/employeeDocuments';
import { Card, Unavailable } from './ui';

/** Your documents on file, as the admin's checklist shows them — what is there and
 * what is still missing. You can open or download a file; adding or removing one is
 * for HR. `docs` is null when the list couldn't be read. */
export default function MyDocuments({ docs }: { docs: EmployeeDocument[] | null }) {
  const { system } = useCalendarSystem();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const byType = useMemo(() => {
    const map = new Map<string, EmployeeDocument[]>();
    for (const d of docs ?? []) map.set(d.doc_type, [...(map.get(d.doc_type) ?? []), d]);
    return map;
  }, [docs]);
  const onFile = DOCUMENT_TYPES.filter(t => byType.has(t.value)).length;

  async function handleView(doc: EmployeeDocument) {
    setActionError('');
    // Opened before the (async) link request so the browser treats it as part of the click.
    const tab = window.open('about:blank', '_blank');
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.file_path, 300);
    if (error || !data) {
      tab?.close();
      setActionError(`Could not open "${doc.file_name}": ${error?.message ?? 'no link was returned'}`);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = data.signedUrl;
    } else {
      window.open(data.signedUrl, '_blank');
    }
  }

  async function handleDownload(doc: EmployeeDocument) {
    setActionError('');
    setBusyId(doc.id);
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(doc.file_path, 60, { download: doc.file_name });
    setBusyId(null);
    if (error || !data) {
      setActionError(`Could not download "${doc.file_name}": ${error?.message ?? 'no link was returned'}`);
      return;
    }
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = doc.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const linkBtn = 'flex h-11 items-center px-1 text-[13px] font-extrabold text-brand disabled:opacity-50 lg:h-9';

  return (
    <Card
      title="Documents"
      note="Added by your employer. Only you and HR can open them."
      right={docs ? <span className="shrink-0 text-[13px] font-bold text-slate-600">{onFile} of {DOCUMENT_TYPES.length} on file</span> : undefined}
    >
      {docs === null ? (
        <Unavailable />
      ) : (
        <>
          {actionError && (
            <p role="alert" className="mt-3 text-[13px] font-semibold text-[#b91c1c]">
              {actionError}
            </p>
          )}
          <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
            {DOCUMENT_TYPES.map(type => {
              const files = byType.get(type.value) ?? [];
              return (
                <li key={type.value} className="py-3">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${files.length > 0 ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white'}`}
                    >
                      {files.length > 0 && (
                        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 12.5 4.5 4.5L19 7.5" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-extrabold">{type.label}</span>
                    <span className={`shrink-0 text-xs font-bold ${files.length > 0 ? 'text-[#14532d]' : 'text-[#c2410c]'}`}>
                      {files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Missing'}
                    </span>
                  </div>
                  {files.length > 0 && (
                    <ul className="ml-8 mt-1.5 flex flex-col gap-1">
                      {files.map(doc => (
                        <li key={doc.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-bold">{doc.title || doc.file_name}</div>
                            <div className="truncate text-xs font-medium text-slate-500">
                              {[doc.title ? doc.file_name : null, formatBytes(doc.size_bytes), formatAdDate(localDateKey(doc.created_at), system)].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button type="button" onClick={() => handleView(doc)} aria-label={`View ${doc.title || doc.file_name}`} className={linkBtn}>
                              View
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownload(doc)}
                              disabled={busyId === doc.id}
                              aria-label={`Download ${doc.title || doc.file_name}`}
                              className={linkBtn}
                            >
                              Download
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
