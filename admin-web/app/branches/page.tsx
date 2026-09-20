'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import { useConfirm } from '@/components/ConfirmDialog';
import type { Branch, BranchDepartment, Department } from '@/lib/types';

const EMPTY_FORM = { name: '' };

// branch_code is only ever unique per-company (uq_branches_company_code),
// never shown to an employee, and nothing keys off its specific value
// (checked: only ever displayed, never matched against) — so it's safe to
// derive from the name instead of making an admin type one. Retried with a
// numeric suffix on a collision rather than checked for uniqueness up
// front, since a race with another insert is always possible either way.
function slugifyBranchName(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'BRANCH';
}

type EmployeeScope = { branch_id: string | null; department: string | null };

export default function BranchesPage() {
  const confirm = useConfirm();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [branchDepartments, setBranchDepartments] = useState<BranchDepartment[]>([]);
  const [employees, setEmployees] = useState<EmployeeScope[]>([]);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [showDeptForm, setShowDeptForm] = useState(false);
  const [deptName, setDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);

  const [addDeptFor, setAddDeptFor] = useState<Record<string, string>>({});

  function reload() {
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches(data ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartments(data ?? []));
    supabase.from('branch_departments').select('*').then(({ data }) => setBranchDepartments(data ?? []));
    supabase.from('employees').select('branch_id, department').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  const departmentsByBranch = useMemo(() => {
    const map: Record<string, Department[]> = {};
    for (const branch of branches) {
      const ids = new Set(branchDepartments.filter(bd => bd.branch_id === branch.id).map(bd => bd.department_id));
      map[branch.id] = departments.filter(d => ids.has(d.id));
    }
    return map;
  }, [branches, departments, branchDepartments]);

  function employeeCount(branchId: string, departmentName: string) {
    return employees.filter(e => e.branch_id === branchId && e.department === departmentName).length;
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({ name: b.name });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    if (editing) {
      const { error } = await supabase.from('branches').update({ name: form.name }).eq('id', editing.id);
      setSaving(false);
      if (error) {
        setFormError(error.message);
        return;
      }
      setShowForm(false);
      reload();
      return;
    }

    // Retry with a numeric suffix on a unique-constraint collision
    // (Postgres 23505) instead of pre-checking — a race with another
    // insert is possible either way, so the retry has to exist regardless.
    const base = slugifyBranchName(form.name);
    let error: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const branch_code = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const result = await supabase.from('branches').insert({ name: form.name, branch_code });
      error = result.error;
      if (!error || error.code !== '23505') break;
    }
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setShowForm(false);
    reload();
  }

  async function handleDelete(id: string) {
    if (!(await confirm('Remove this branch? Employees/devices assigned to it will need reassigning.', { title: 'Remove branch?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const { error } = await supabase.from('branches').delete().eq('id', id);
    if (error) alert(`Could not remove: ${error.message}`);
    reload();
  }

  async function handleAddDepartment(e: React.FormEvent) {
    e.preventDefault();
    setDeptError(null);
    const name = deptName.trim();
    if (!name) return;
    setSavingDept(true);
    const { error } = await supabase.from('departments').insert({ name });
    setSavingDept(false);
    if (error) {
      setDeptError(error.code === '23505' ? 'That department already exists.' : error.message);
      return;
    }
    setDeptName('');
    setShowDeptForm(false);
    reload();
  }

  async function handleDeleteDepartment(dept: Department) {
    if (!(await confirm(`Remove the "${dept.name}" department? It will be unlinked from every branch.`, { title: 'Remove department?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const { error } = await supabase.from('departments').delete().eq('id', dept.id);
    if (error) alert(`Could not remove: ${error.message}`);
    reload();
  }

  async function handleLinkDepartment(branchId: string) {
    const departmentId = addDeptFor[branchId];
    if (!departmentId) return;
    const { error } = await supabase.from('branch_departments').insert({ branch_id: branchId, department_id: departmentId });
    if (error) {
      alert(`Could not add: ${error.message}`);
      return;
    }
    setAddDeptFor(p => ({ ...p, [branchId]: '' }));
    reload();
  }

  async function handleUnlinkDepartment(branchId: string, departmentId: string) {
    const { error } = await supabase
      .from('branch_departments')
      .delete()
      .eq('branch_id', branchId)
      .eq('department_id', departmentId);
    if (error) alert(`Could not remove: ${error.message}`);
    reload();
  }

  return (
    <AppShell title="Branch/Depart">
      <p className="mb-5 max-w-2xl text-sm text-slate-500">
        Each branch&apos;s location and radius, mainly for reference. An employee must be assigned to a branch
        (Employees page) for their GPS check-in to work at all — without one, the server rejects every GPS punch.
        Distance from the branch is no longer enforced. Instead, every phone check-in/check-out waits in the
        Corrections page for Admin/HR to approve before it counts as attendance.
      </p>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-ink">Departments</h3>
          <button
            onClick={() => {
              setDeptName('');
              setDeptError(null);
              setShowDeptForm(true);
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
          >
            + Add Department
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {departments.map(d => (
            <span
              key={d.id}
              className="flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
            >
              {d.name}
              <button
                onClick={() => handleDeleteDepartment(d)}
                title="Remove department"
                className="text-accent/60 hover:text-critical"
              >
                ×
              </button>
            </span>
          ))}
          {departments.length === 0 && <p className="text-sm text-slate-400">No departments yet.</p>}
        </div>
      </div>

      <div className="mb-5 flex justify-end">
        <button onClick={openAdd} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90">
          + Add Branch
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map(b => {
          const linked = departmentsByBranch[b.id] ?? [];
          const linkedIds = new Set(linked.map(d => d.id));
          const available = departments.filter(d => !linkedIds.has(d.id));
          return (
            <div key={b.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-1 font-semibold text-ink">{b.name}</h3>
              <p className="mb-3 text-xs text-slate-400">{b.branch_code}</p>
              {b.latitude != null && b.longitude != null && (
                <p className="text-sm text-slate-600">
                  📍 {b.latitude.toFixed(5)}, {b.longitude.toFixed(5)}
                </p>
              )}
              <p className="text-sm text-slate-600">↔ {b.radius_meters}m radius</p>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-1.5 text-xs font-medium text-slate-500">Departments</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {linked.map(d => (
                    <span
                      key={d.id}
                      className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
                    >
                      {d.name}
                      <span className="text-accent/70">· {employeeCount(b.id, d.name)}</span>
                      <button
                        onClick={() => handleUnlinkDepartment(b.id, d.id)}
                        title="Remove from this branch"
                        className="text-accent/60 hover:text-critical"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {linked.length === 0 && <span className="text-xs text-slate-400">None yet</span>}
                </div>
                {available.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      value={addDeptFor[b.id] ?? ''}
                      onChange={e => setAddDeptFor(p => ({ ...p, [b.id]: e.target.value }))}
                      className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                    >
                      <option value="">Select a department…</option>
                      {available.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleLinkDepartment(b.id)}
                      disabled={!addDeptFor[b.id]}
                      className="shrink-0 rounded-md border border-accent px-2 py-1 text-xs font-semibold text-accent disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 flex gap-3 border-t border-slate-100 pt-3 text-xs font-medium">
                <button onClick={() => openEdit(b)} className="text-accent hover:underline">
                  Edit
                </button>
                <button onClick={() => handleDelete(b.id)} className="text-critical hover:underline">
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        {branches.length === 0 && <p className="text-sm text-slate-400">No branches yet — add one to enable GPS check-in.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleSave} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">{editing ? 'Edit Branch' : 'Add Branch'}</h3>

            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            {formError && <p className="mb-3 text-sm text-critical">{formError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add branch'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showDeptForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddDepartment} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Department</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              autoFocus
              value={deptName}
              onChange={e => setDeptName(e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {deptError && <p className="mb-3 text-sm text-critical">{deptError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDeptForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingDept}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {savingDept ? 'Saving…' : 'Add department'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
