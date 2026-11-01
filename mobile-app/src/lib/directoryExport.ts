import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Branch, Employee } from '../types';
import { formatAdDate, localDateKey, type CalendarSystem } from './calendar';
import { EMPLOYMENT_STATUS_LABEL, effectiveStatus, employmentTypeLabel } from './employeeProfile';

export type DirectoryRow = {
  sn: number;
  code: string;
  biometric: string;
  name: string;
  designation: string;
  department: string;
  outlet: string;
  type: string;
  joined: string;
  contractStart: string;
  contractEnd: string;
  reportsTo: string;
  phone: string;
  officialPhone: string;
  email: string;
  personalEmail: string;
  status: string;
  lastDay: string;
};

/** One row per employee the current filters match (all of them, not just those on screen). */
export function directoryRows(filtered: Employee[], everyone: Employee[], branches: Branch[], system: CalendarSystem): DirectoryRow[] {
  const nameById = new Map(everyone.map(e => [e.id, e.name]));
  const branchById = new Map(branches.map(b => [b.id, b.name]));
  const date = (value: string | null | undefined) => (value ? formatAdDate(value, system) : '');
  return filtered.map((e, i) => ({
    sn: i + 1,
    code: e.employee_code,
    biometric: e.fingerprint_id ?? '',
    name: e.name,
    designation: e.designation ?? '',
    department: e.department ?? '',
    outlet: (e.branch_id && branchById.get(e.branch_id)) || '',
    type: employmentTypeLabel(e.employment_type),
    joined: date(e.date_of_joining),
    contractStart: date(e.employment_type === 'contract' ? e.contract_start : null),
    contractEnd: date(e.employment_type === 'contract' ? e.contract_end : null),
    reportsTo: (e.reporting_to && nameById.get(e.reporting_to)) || '',
    phone: e.phone ?? '',
    officialPhone: e.official_phone ?? '',
    email: e.email ?? '',
    personalEmail: e.personal_email ?? '',
    status: EMPLOYMENT_STATUS_LABEL[effectiveStatus(e)],
    lastDay: date(e.resigned_at),
  }));
}

const quote = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function directoryCsv(rows: DirectoryRow[], company: string): string {
  const header = [
    'S.N.', 'Employee ID', 'Biometric ID', 'Full name', 'Company', 'Designation', 'Department', 'Outlet', 'Employment type', 'Date of joining',
    'Contract start', 'Contract end', 'Reporting to', 'Phone (personal)', 'Phone (official)', 'Email (official)', 'Email (personal)', 'Status', 'Last working date',
  ];
  const lines = rows.map(r =>
    [r.sn, r.code, r.biometric, r.name, company, r.designation, r.department, r.outlet, r.type, r.joined, r.contractStart, r.contractEnd, r.reportsTo, r.phone, r.officialPhone, r.email, r.personalEmail, r.status, r.lastDay]
      .map(quote)
      .join(',')
  );
  // The BOM makes Excel read the file as UTF-8 (names, Devanagari dates).
  return '﻿' + [header.map(quote).join(','), ...lines].join('\r\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function directoryHtml(rows: DirectoryRow[], company: string): string {
  const columns: { title: string; value: (r: DirectoryRow) => string }[] = [
    { title: 'S.N.', value: r => String(r.sn) },
    { title: 'Employee ID', value: r => r.code },
    { title: 'Full name', value: r => r.name },
    { title: 'Designation', value: r => r.designation },
    { title: 'Department', value: r => r.department },
    { title: 'Outlet', value: r => r.outlet },
    { title: 'Type', value: r => r.type },
    { title: 'Joined', value: r => r.joined },
    { title: 'Reports to', value: r => r.reportsTo },
    { title: 'Status', value: r => r.status },
    { title: 'Phone', value: r => r.phone },
  ];
  const head = columns.map(c => `<th>${esc(c.title)}</th>`).join('');
  const body = rows.map(r => `<tr>${columns.map(c => `<td>${esc(c.value(r) || '—')}</td>`).join('')}</tr>`).join('');
  return `<html><head><meta charset="utf-8"><style>
    @page{size:A4 landscape;margin:10mm}
    body{font-family:Helvetica,Arial,sans-serif;color:#0f172a;font-size:9px}
    h1{font-size:15px;margin:0 0 2px} .muted{color:#64748b;margin-bottom:8px}
    table{width:100%;border-collapse:collapse} th{background:#f1f5f9;text-align:left}
    th,td{padding:4px 5px;border-bottom:1px solid #e2e8f0} thead{display:table-header-group} tr{page-break-inside:avoid}
  </style></head><body>
    <h1>${esc(company ? company + ' — ' : '')}Employee Directory</h1>
    <div class="muted">${rows.length} employee${rows.length === 1 ? '' : 's'}  ·  ${esc(localDateKey(new Date().toISOString()))}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
  </body></html>`;
}

/** Hand a text file to the person: the share sheet on a phone, a download in a browser. */
export async function shareTextFile(name: string, mimeType: string, content: string): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  const uri = `${FileSystem.cacheDirectory}${name}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: name });
}

/** A PDF of `html`: the share sheet on a phone, the browser's print dialog on the web. */
export async function sharePdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title });
}
