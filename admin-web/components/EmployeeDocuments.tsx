'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useConfirm } from './ConfirmDialog';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  ACCEPT_ATTRIBUTE,
  DOCUMENTS_BUCKET,
  DOCUMENT_TYPES,
  documentContentType,
  documentStoragePath,
  formatBytes,
  validateDocumentFile,
  type DocumentType,
  type EmployeeDocument,
} from '@/lib/employeeDocuments';

/** An employee's documents: a checklist of the 17 kinds HR keeps, each with
 * its uploaded files. Files sit in a private bucket and are only ever opened
 * through a short-lived signed link made on the spot. */
export default function EmployeeDocuments({
  employeeId,
  companyId,
}: {
  employeeId: string;
  /** Names the top folder of every stored file, which the bucket's access rules check. */
  companyId: string | null;
}) {
  const confirm = useConfirm();
  const { system } = useCalendarSystem();
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [uploadType, setUploadType] = useState<DocumentType | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setStatus('unavailable');
      return;
    }
    setDocs((data ?? []) as EmployeeDocument[]);
    setStatus('ready');
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const byType = useMemo(() => {
    const map = new Map<DocumentType, EmployeeDocument[]>();
    for (const d of docs) map.set(d.doc_type, [...(map.get(d.doc_type) ?? []), d]);
    return map;
  }, [docs]);
  const typesOnFile = DOCUMENT_TYPES.filter(t => byType.has(t.value)).length;

  const typeLabel = DOCUMENT_TYPES.find(t => t.value === uploadType)?.label ?? '';
  const problems = picked.map(f => validateDocumentFile(f)).filter((m): m is string => m !== null);

  function openUpload(type: DocumentType) {
    setUploadType(type);
    setPicked([]);
    setLabel('');
    setUploadError('');
  }

  function closeUpload() {
    if (!uploading) setUploadType(null);
  }

  // Escape closes the upload dialog, like the other dialogs on this page.
  useEffect(() => {
    if (!uploadType) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !uploading) setUploadType(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [uploadType, uploading]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadType || !companyId || picked.length === 0 || problems.length > 0) return;
    setUploading(true);
    setUploadError('');
    let failure = '';
    for (const file of picked) {
      const path = documentStoragePath(companyId, employeeId, file.name);
      const contentType = documentContentType(file.name);
      const { error: storageError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, file, { contentType, upsert: false });
      if (storageError) {
        failure = `Could not upload "${file.name}": ${storageError.message}`;
        break;
      }
      const { error: rowError } = await supabase.from('employee_documents').insert({
        employee_id: employeeId,
        doc_type: uploadType,
        // One label would be wrong for several different files, so it only applies to a single upload.
        title: picked.length === 1 ? label.trim() || null : null,
        file_path: path,
        file_name: file.name,
        mime_type: contentType,
        size_bytes: file.size,
      });
      if (rowError) {
        // Don't leave a file behind that nothing points to.
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
        failure = `Could not save "${file.name}": ${rowError.message}`;
        break;
      }
    }
    setUploading(false);
    await load();
    if (failure) {
      setUploadError(failure);
      return;
    }
    setUploadType(null);
  }

  async function handleView(doc: EmployeeDocument) {
    setActionError('');
    // Opened before the (async) link request so the browser sees it as part of
    // the click — a window opened after an await is treated as a pop-up and blocked.
    const tab = window.open('about:blank', '_blank');
    // Five minutes, not one: a PDF viewer may ask for more of the file as you scroll.
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
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(doc.file_path, 60, { download: doc.file_name });
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

  async function handleDelete(doc: EmployeeDocument) {
    const name = doc.title || doc.file_name;
    if (
      !(await confirm(`Delete "${name}"? The file is permanently removed and can't be recovered.`, {
        title: 'Delete document?',
        confirmLabel: 'Delete',
        tone: 'danger',
      }))
    )
      return;
    setActionError('');
    setBusyId(doc.id);
    // File first: if this fails the record stays and the delete can be retried,
    // rather than leaving a private file that nothing points to.
    const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.file_path]);
    if (storageError) {
      setBusyId(null);
      setActionError(`Could not delete "${name}": ${storageError.message}`);
      return;
    }
    const { error: rowError } = await supabase.from('employee_documents').delete().eq('id', doc.id);
    setBusyId(null);
    if (rowError) {
      setActionError(`The file was removed but its record could not be: ${rowError.message}`);
    }
    load();
  }

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="employee-documents-heading">
      <div className="flex items-center justify-between">
        <h2 id="employee-documents-heading" className="text-sm font-semibold text-ink">
          Documents
        </h2>
        {status === 'ready' && (
          <span className="text-xs text-slate-500">
            {typesOnFile} of {DOCUMENT_TYPES.length} kinds on file
          </span>
        )}
      </div>
      <div className="mb-2 mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(typesOnFile / DOCUMENT_TYPES.length) * 100}%` }} />
      </div>
      <p className="mb-3 text-xs text-slate-400">
        PDF, image or Word file, up to 10 MB each. Stored privately — only admins and HR of your company, and this employee, can open them. The employee can add files and remove only their own.
      </p>

      {status === 'unavailable' && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-text" role="alert">
          Documents can&apos;t be loaded yet. If this is the first time, run the latest database migration
          (20261101140000_employee_documents.sql) in Supabase. <span className="opacity-70">({loadError})</span>
        </div>
      )}
      {status !== 'unavailable' && !companyId && (
        <p className="mb-3 text-xs text-critical" role="alert">
          This employee has no company recorded, so files can&apos;t be stored for them.
        </p>
      )}
      {actionError && (
        <p className="mb-3 text-xs text-critical" role="alert">
          {actionError}
        </p>
      )}

      {status !== 'unavailable' && (
        <ul className="divide-y divide-slate-100">
          {DOCUMENT_TYPES.map(type => {
            const files = byType.get(type.value) ?? [];
            return (
              <li key={type.value} className="py-2.5">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                      files.length > 0 ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white'
                    }`}
                    aria-hidden="true"
                  >
                    {files.length > 0 && <CheckIcon className="h-2.5 w-2.5" />}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">{type.label}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Missing'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openUpload(type.value)}
                    disabled={status !== 'ready' || !companyId}
                    aria-label={`Upload ${type.label}`}
                    className="shrink-0 text-xs font-medium text-accent hover:underline disabled:opacity-40 disabled:hover:no-underline"
                  >
                    + Upload
                  </button>
                </div>

                {files.length > 0 && (
                  <ul className="ml-7 mt-2 space-y-1.5">
                    {files.map(doc => (
                      <li key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-3 py-2">
                        <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">
                            {doc.title || doc.file_name}
                            {doc.uploaded_by_employee && (
                              <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Added by employee</span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {[
                              doc.title ? doc.file_name : null,
                              formatBytes(doc.size_bytes) || null,
                              formatAdDate(localDateKey(doc.created_at), system),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => handleView(doc)}
                            className="text-xs font-medium text-accent hover:underline"
                            aria-label={`View ${doc.title || doc.file_name}`}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownload(doc)}
                            disabled={busyId === doc.id}
                            className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
                            aria-label={`Download ${doc.title || doc.file_name}`}
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(doc)}
                            disabled={busyId === doc.id}
                            className="text-xs font-medium text-critical hover:underline disabled:opacity-50"
                            aria-label={`Delete ${doc.title || doc.file_name}`}
                          >
                            Delete
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {uploadType && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4" onClick={closeUpload}>
          <form
            onSubmit={handleUpload}
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-label={`Upload ${typeLabel}`}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
          >
            <h3 className="text-lg font-semibold text-ink">Upload document</h3>
            <p className="mb-4 text-sm text-slate-500">{typeLabel}</p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              onChange={e => {
                setPicked(Array.from(e.target.files ?? []));
                setUploadError('');
              }}
              className="hidden"
              aria-label="Choose files"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-lg border-2 border-dashed border-slate-300 px-3 py-5 text-sm font-medium text-slate-600 hover:border-accent hover:text-accent disabled:opacity-60"
            >
              {picked.length === 0 ? 'Choose file(s)…' : 'Choose different file(s)…'}
            </button>

            {picked.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {picked.map(f => {
                  const problem = validateDocumentFile(f);
                  return (
                    <li key={`${f.name}-${f.size}`} className={problem ? 'text-critical' : 'text-ink'}>
                      {problem ?? (
                        <>
                          {f.name} <span className="text-xs text-slate-400">· {formatBytes(f.size)}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {picked.length === 1 && (
              <label className="mt-4 block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Label (optional)</span>
                <input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. SEE certificate"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            )}

            {uploadError && (
              <p className="mt-3 text-sm text-critical" role="alert">
                {uploadError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeUpload}
                disabled={uploading}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading || picked.length === 0 || problems.length > 0}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {uploading ? 'Uploading…' : picked.length > 1 ? `Upload ${picked.length} files` : 'Upload'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5 9-10" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5" />
    </svg>
  );
}
