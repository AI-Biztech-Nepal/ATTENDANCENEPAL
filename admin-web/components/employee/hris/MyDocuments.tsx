'use client';

import { useMemo, useRef, useState } from 'react';
import FormDialog from '@/components/employee/FormDialog';
import { StatusTag } from '@/components/employee/parts';
import { useConfirm } from '@/components/ConfirmDialog';
import { supabase } from '@/lib/supabase';
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
import { Card, Unavailable } from './ui';

/** Your documents on file, as the admin's checklist shows them — what is there and what is
 * still missing. You can open or download any of them, add your own, and remove what you
 * added; what HR filed stays. `docs` is null when the list couldn't be read. */
export default function MyDocuments({
  docs,
  employeeId,
  companyId,
  onChanged,
}: {
  docs: EmployeeDocument[] | null;
  employeeId: string;
  /** Names the top folder of every stored file, which the bucket's access rules check. */
  companyId: string | null;
  /** Called after an upload or a removal, so the page re-reads the list. */
  onChanged: () => void;
}) {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const [uploadType, setUploadType] = useState<DocumentType | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const byType = useMemo(() => {
    const map = new Map<string, EmployeeDocument[]>();
    for (const d of docs ?? []) map.set(d.doc_type, [...(map.get(d.doc_type) ?? []), d]);
    return map;
  }, [docs]);
  const onFile = DOCUMENT_TYPES.filter(t => byType.has(t.value)).length;
  const typeLabel = DOCUMENT_TYPES.find(t => t.value === uploadType)?.label ?? '';
  const fileProblems = picked.map(f => validateDocumentFile(f)).filter((m): m is string => m !== null);

  function openUpload(type: DocumentType) {
    setUploadType(type);
    setPicked([]);
    setLabel('');
    setUploadError('');
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadType || !companyId || picked.length === 0 || fileProblems.length > 0) return;
    setUploading(true);
    setUploadError('');
    let failure = '';
    for (const file of picked) {
      const path = documentStoragePath(companyId, employeeId, file.name);
      const contentType = documentContentType(file.name);
      const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType, upsert: false });
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
        uploaded_by_employee: true,
      });
      if (rowError) {
        // Don't leave a file behind that nothing points to.
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
        failure = `Could not save "${file.name}": ${rowError.message}`;
        break;
      }
    }
    setUploading(false);
    onChanged();
    if (failure) {
      setUploadError(failure);
      return;
    }
    setUploadType(null);
  }

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

  async function handleRemove(doc: EmployeeDocument) {
    const name = doc.title || doc.file_name;
    if (!(await confirm(`Remove "${name}"? The file is permanently deleted.`, { title: 'Remove document?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    setActionError('');
    setBusyId(doc.id);
    // File first: if this fails the record stays and it can be retried, rather than leaving a
    // private file that nothing points to.
    const { error: storageError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.file_path]);
    if (storageError) {
      setBusyId(null);
      setActionError(`Could not remove "${name}": ${storageError.message}`);
      return;
    }
    const { error: rowError } = await supabase.from('employee_documents').delete().eq('id', doc.id);
    setBusyId(null);
    if (rowError) setActionError(`The file was removed but its record could not be: ${rowError.message}`);
    onChanged();
  }

  const linkBtn = 'flex h-11 items-center px-1 text-[13px] font-extrabold text-brand disabled:opacity-50 lg:h-9';

  return (
    <Card
      title="Documents"
      note="Added by your employer or by you. You can remove only what you added. Only you and HR can open them."
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
                    <button type="button" onClick={() => openUpload(type.value)} disabled={!companyId} aria-label={`Upload ${type.label}`} className={`${linkBtn} shrink-0`}>
                      Upload
                    </button>
                  </div>
                  {files.length > 0 && (
                    <ul className="ml-8 mt-1.5 flex flex-col gap-1">
                      {files.map(doc => (
                        <li key={doc.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[13px] font-bold">{doc.title || doc.file_name}</span>
                              {doc.uploaded_by_employee && <StatusTag tone="brand">Added by you</StatusTag>}
                            </div>
                            <div className="truncate text-xs font-medium text-slate-500">
                              {[doc.title ? doc.file_name : null, formatBytes(doc.size_bytes), formatAdDate(localDateKey(doc.created_at), system)].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button type="button" onClick={() => handleView(doc)} aria-label={`View ${doc.title || doc.file_name}`} className={linkBtn}>
                              View
                            </button>
                            <button type="button" onClick={() => handleDownload(doc)} disabled={busyId === doc.id} aria-label={`Download ${doc.title || doc.file_name}`} className={linkBtn}>
                              Download
                            </button>
                            {doc.uploaded_by_employee && (
                              <button
                                type="button"
                                onClick={() => handleRemove(doc)}
                                disabled={busyId === doc.id}
                                aria-label={`Remove ${doc.title || doc.file_name}`}
                                className="flex h-11 items-center px-1 text-[13px] font-extrabold text-[#b91c1c] disabled:opacity-50 lg:h-9"
                              >
                                Remove
                              </button>
                            )}
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

      {uploadType && (
        <FormDialog
          title="Upload document"
          note={typeLabel}
          onSubmit={handleUpload}
          onClose={() => !uploading && setUploadType(null)}
          saving={uploading}
          savingLabel="Uploading…"
          submitLabel={picked.length > 1 ? `Upload ${picked.length} files` : 'Upload'}
          submitDisabled={picked.length === 0 || fileProblems.length > 0}
          error={uploadError}
        >
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
            className="w-full rounded-xl border-2 border-dashed border-slate-300 px-3 py-5 text-sm font-bold text-slate-600 hover:border-brand hover:text-brand disabled:opacity-60"
          >
            {picked.length === 0 ? 'Choose file(s)…' : 'Choose different file(s)…'}
          </button>
          <p className="mt-2 text-xs text-slate-500">PDF, image or Word file, up to 10 MB each.</p>
          {picked.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {picked.map(f => {
                const problem = validateDocumentFile(f);
                return (
                  <li key={`${f.name}-${f.size}`} className={problem ? 'font-semibold text-[#b91c1c]' : ''}>
                    {problem ?? (
                      <>
                        {f.name} <span className="text-xs text-slate-500">· {formatBytes(f.size)}</span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {picked.length === 1 && (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">Label (optional)</span>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                maxLength={80}
                placeholder="e.g. SEE certificate"
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium"
              />
            </label>
          )}
        </FormDialog>
      )}
    </Card>
  );
}
