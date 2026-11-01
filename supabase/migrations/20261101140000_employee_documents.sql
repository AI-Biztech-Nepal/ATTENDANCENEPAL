-- Employee documents: CVs, citizenship copies, contracts, letters, ... kept in
-- a PRIVATE storage bucket, one `employee_documents` row per uploaded file.
--
-- Unlike `attendance-selfies` (public read, any authenticated user may write),
-- nothing here is readable without a signed link, and only an admin or HR user
-- of the SAME company can list, upload, open or delete a file. Run once, in the
-- Supabase SQL editor, after 20261101120000_employee_hr_profile.sql.

-- ---------------------------------------------------------------------------
-- The bucket. Private; 10 MB per file; PDFs, images and Word documents only.
-- (Re-running this resets the limits and keeps it private.)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-documents',
  'employee-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Files live at  <company id>/<employee id>/<random name>.<ext>, so the first
-- folder of the path says which company owns the file.
drop policy if exists "employee-documents: admin or hr read" on storage.objects;
create policy "employee-documents: admin or hr read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employee-documents'
    and is_admin_or_hr()
    and (storage.foldername(name))[1] = my_company_id()::text
  );

drop policy if exists "employee-documents: admin or hr upload" on storage.objects;
create policy "employee-documents: admin or hr upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employee-documents'
    and is_admin_or_hr()
    and (storage.foldername(name))[1] = my_company_id()::text
  );

drop policy if exists "employee-documents: admin or hr delete" on storage.objects;
create policy "employee-documents: admin or hr delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employee-documents'
    and is_admin_or_hr()
    and (storage.foldername(name))[1] = my_company_id()::text
  );

-- ---------------------------------------------------------------------------
-- One row per uploaded file.
-- ---------------------------------------------------------------------------

create table if not exists employee_documents (
  id uuid primary key default gen_random_uuid(),
  -- Deleting an employee removes the rows; the admin site removes the files
  -- from storage itself (the database cannot).
  employee_id uuid not null references employees(id) on delete cascade,
  company_id uuid references companies(id),
  doc_type text not null,
  -- Optional note on what this particular file is ("SEE certificate").
  title text,
  -- Where the file is in the bucket, and the name it had when uploaded.
  file_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint employee_documents_doc_type_check check (
    doc_type in (
      'cv',
      'application_form',
      'citizenship',
      'photograph',
      'education_certificate',
      'training_certificate',
      'experience_certificate',
      'employment_agreement',
      'probation_evaluation',
      'promotion_letter',
      'transfer_letter',
      'salary_revision_letter',
      'warning_letter',
      'performance_appraisal',
      'resignation_letter',
      'final_settlement',
      'relieving_letter'
    )
  )
);
create index if not exists idx_employee_documents_employee on employee_documents(employee_id, doc_type);

alter table employee_documents enable row level security;

-- company_id is stamped from the employee, never trusted from the caller.
drop trigger if exists trg_stamp_company_id on employee_documents;
create trigger trg_stamp_company_id before insert on employee_documents
  for each row execute function stamp_company_id_from_employee();

-- Admin / HR of the same company only. Deliberately no employee-read policy:
-- warning letters and appraisals are not for the employee's own browser.
drop policy if exists "employee_documents: admin or hr full access" on employee_documents;
create policy "employee_documents: admin or hr full access" on employee_documents
  for all
  using (is_admin_or_hr() and company_id = my_company_id())
  with check (is_admin_or_hr() and company_id = my_company_id());
