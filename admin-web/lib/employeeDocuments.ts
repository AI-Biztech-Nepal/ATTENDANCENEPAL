/** The private storage bucket created by 20261101140000_employee_documents.sql. */
export const DOCUMENTS_BUCKET = 'employee-documents';

/** Same limit the bucket enforces; checked here first so a too-big file is
 * refused instantly instead of after a long upload. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The 17 kinds of document HR keeps per employee, in the order the HRIS spec
 * lists them. `value` is what is stored — it must match the doc_type check in
 * the migration. */
export const DOCUMENT_TYPES = [
  { value: 'cv', label: 'Updated CV / Resume' },
  { value: 'application_form', label: 'Job Application Form' },
  { value: 'citizenship', label: 'Citizenship Certificate' },
  { value: 'photograph', label: 'Passport-size Photograph' },
  { value: 'education_certificate', label: 'Educational Certificates' },
  { value: 'training_certificate', label: 'Training Certificates' },
  { value: 'experience_certificate', label: 'Experience Certificates' },
  { value: 'employment_agreement', label: 'Employment Agreement / Contract' },
  { value: 'probation_evaluation', label: 'Probation Evaluation' },
  { value: 'promotion_letter', label: 'Promotion Letter' },
  { value: 'transfer_letter', label: 'Transfer Letter' },
  { value: 'salary_revision_letter', label: 'Salary Revision Letter' },
  { value: 'warning_letter', label: 'Warning / Explanation / Show-Cause Letters' },
  { value: 'performance_appraisal', label: 'Performance Appraisal' },
  { value: 'resignation_letter', label: 'Resignation Letter' },
  { value: 'final_settlement', label: 'Final Settlement Documents' },
  { value: 'relieving_letter', label: 'Experience / Relieving Letter' },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]['value'];

export type EmployeeDocument = {
  id: string;
  employee_id: string;
  doc_type: DocumentType;
  title: string | null;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

/** What may be uploaded — the same set the bucket allows. */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** For the file picker's `accept`. */
export const ACCEPT_ATTRIBUTE = Object.keys(CONTENT_TYPE_BY_EXTENSION)
  .map(ext => `.${ext}`)
  .join(',');

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** A message if this file can't be stored, otherwise null. Judged by the
 * extension (what the person picked) rather than the browser's guess at the
 * type, which is empty or wrong for some Word files. */
export function validateDocumentFile(file: { name: string; size: number }): string | null {
  if (!(fileExtension(file.name) in CONTENT_TYPE_BY_EXTENSION)) {
    return `"${file.name}" isn't a supported file. Use PDF, JPG, PNG, WebP or Word (.doc / .docx).`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_DOCUMENT_BYTES)}.`;
  }
  return null;
}

export function documentContentType(fileName: string): string {
  return CONTENT_TYPE_BY_EXTENSION[fileExtension(fileName)] ?? 'application/octet-stream';
}

/** <company id>/<employee id>/<random>.<ext>. The stored name is random so a
 * person's own file name (spaces, Nepali script, "../") never becomes part of
 * a storage path; the original name is kept in the database for display and
 * for the download. The company id comes first because the bucket's access
 * rules look at that folder. */
export function documentStoragePath(companyId: string, employeeId: string, fileName: string): string {
  return `${companyId}/${employeeId}/${crypto.randomUUID()}.${fileExtension(fileName)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
