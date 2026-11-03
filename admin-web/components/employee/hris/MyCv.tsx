'use client';

import { useCallback, useEffect, useState } from 'react';
import DatePicker from '@/components/DatePicker';
import FormDialog from '@/components/employee/FormDialog';
import { useConfirm } from '@/components/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { degreeLabel, experienceSummary, formatDuration, formatPassingYear, highestQualification } from '@/lib/employeeProfile';
import { SKILL_CATEGORIES } from '@/lib/skillCategories';
import type { Employee, EmployeeEducation, EmployeeTraining, EmployeeWorkExperience } from '@/lib/types';
import { Card, DANGER_BTN, Empty, LINK_BTN, Unavailable } from './ui';

const EMPTY_EDUCATION = { degree: '', institution: '', board_university: '', year: '', year_calendar: 'AD' };
const EMPTY_TRAINING = { title: '', provider: '', start_date: '', end_date: '' };
const EMPTY_EXPERIENCE = { employer: '', role: '', description: '', start_date: '', end_date: '' };

const INPUT = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

type Dialog = { kind: 'education' | 'training' | 'experience' | 'skill'; id: string | null } | null;

function tenureDays(start: string | null, end: string | null) {
  if (!start) return null;
  const to = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, Math.floor((to - new Date(start).getTime()) / 86400000));
}

/** The CV side of the profile — education, training, work experience and skills — the column the
 * admin's Records tab has beside the HR records. All of it is the employee's own to add to, change
 * and remove. Each list loads on its own; training that can't be read says so. */
export default function MyCv({ employee, onSaveSkills }: { employee: Employee; onSaveSkills: (skills: string[]) => Promise<string | null> }) {
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const employeeId = employee.id;

  const [education, setEducation] = useState<EmployeeEducation[]>([]);
  const [training, setTraining] = useState<EmployeeTraining[] | null>([]);
  const [experience, setExperience] = useState<EmployeeWorkExperience[]>([]);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [educationForm, setEducationForm] = useState(EMPTY_EDUCATION);
  const [trainingForm, setTrainingForm] = useState(EMPTY_TRAINING);
  const [experienceForm, setExperienceForm] = useState(EMPTY_EXPERIENCE);
  const [skillCategory, setSkillCategory] = useState<(typeof SKILL_CATEGORIES)[number]>(SKILL_CATEGORIES[0]);
  const [skillInput, setSkillInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [skillError, setSkillError] = useState('');

  const load = useCallback(() => {
    supabase
      .from('employee_education')
      .select('*')
      .eq('employee_id', employeeId)
      .order('year', { ascending: false })
      .then(({ data }) => setEducation((data ?? []) as EmployeeEducation[]));
    supabase
      .from('employee_training')
      .select('*')
      .eq('employee_id', employeeId)
      .order('start_date', { ascending: false })
      .then(({ data, error: err }) => setTraining(err ? null : ((data ?? []) as EmployeeTraining[])));
    supabase
      .from('employee_work_experience')
      .select('*')
      .eq('employee_id', employeeId)
      .order('start_date', { ascending: false })
      .then(({ data }) => setExperience((data ?? []) as EmployeeWorkExperience[]));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const date = (d: string | null | undefined) => (d ? formatAdDate(d, system) : '—');

  function close() {
    if (!saving) setDialog(null);
  }

  function openEducation(ed: EmployeeEducation | null) {
    setEducationForm(
      ed
        ? { degree: ed.degree, institution: ed.institution ?? '', board_university: ed.board_university ?? '', year: ed.year ? String(ed.year) : '', year_calendar: ed.year_calendar ?? 'AD' }
        : EMPTY_EDUCATION
    );
    setError('');
    setDialog({ kind: 'education', id: ed?.id ?? null });
  }
  function openTraining(t: EmployeeTraining | null) {
    setTrainingForm(t ? { title: t.title, provider: t.provider ?? '', start_date: t.start_date ?? '', end_date: t.end_date ?? '' } : EMPTY_TRAINING);
    setError('');
    setDialog({ kind: 'training', id: t?.id ?? null });
  }
  function openExperience(x: EmployeeWorkExperience | null) {
    setExperienceForm(
      x ? { employer: x.employer, role: x.role ?? '', description: x.description ?? '', start_date: x.start_date ?? '', end_date: x.end_date ?? '' } : EMPTY_EXPERIENCE
    );
    setError('');
    setDialog({ kind: 'experience', id: x?.id ?? null });
  }
  function openSkill() {
    setSkillInput('');
    setError('');
    setDialog({ kind: 'skill', id: null });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dialog) return;
    setError('');

    if (dialog.kind === 'skill') {
      const value = skillInput.trim();
      if (!value) return;
      const skill = `${skillCategory}: ${value}`;
      if (!employee.skills.includes(skill)) {
        setSaving(true);
        const message = await onSaveSkills([...employee.skills, skill]);
        setSaving(false);
        if (message) return setError(`Could not add skill: ${message}`);
      }
      setDialog(null);
      return;
    }

    if (dialog.kind === 'training' && trainingForm.start_date && trainingForm.end_date && trainingForm.end_date < trainingForm.start_date) {
      return setError('The end date is before the start date.');
    }

    const table = dialog.kind === 'education' ? 'employee_education' : dialog.kind === 'training' ? 'employee_training' : 'employee_work_experience';
    const row =
      dialog.kind === 'education'
        ? {
            degree: educationForm.degree,
            institution: educationForm.institution || null,
            board_university: educationForm.board_university || null,
            year: educationForm.year ? Number(educationForm.year) : null,
            year_calendar: educationForm.year_calendar,
          }
        : dialog.kind === 'training'
          ? {
              title: trainingForm.title.trim(),
              provider: trainingForm.provider.trim() || null,
              start_date: trainingForm.start_date || null,
              end_date: trainingForm.end_date || null,
            }
          : {
              employer: experienceForm.employer,
              role: experienceForm.role || null,
              description: experienceForm.description || null,
              start_date: experienceForm.start_date || null,
              end_date: experienceForm.end_date || null,
            };
    setSaving(true);
    const { error: saveError } = dialog.id
      ? await supabase.from(table).update(row).eq('id', dialog.id)
      : await supabase.from(table).insert({ ...row, employee_id: employeeId });
    setSaving(false);
    if (saveError) return setError(`Could not save: ${saveError.message}`);
    setDialog(null);
    load();
  }

  async function remove(table: 'employee_education' | 'employee_training' | 'employee_work_experience', id: string, what: string) {
    if (!(await confirm(`Remove ${what}?`, { title: 'Remove entry?', confirmLabel: 'Remove', tone: 'danger' }))) return;
    await supabase.from(table).delete().eq('id', id);
    load();
  }

  async function removeSkill(skill: string) {
    setSkillError('');
    const message = await onSaveSkills(employee.skills.filter(s => s !== skill));
    if (message) setSkillError(`Could not remove skill: ${message}`);
  }

  const highest = highestQualification(education);
  const summary = experienceSummary(experience, employee.date_of_joining, employee.resigned_at);
  const titles = { education: 'Education', training: 'Training', experience: 'Work Experience', skill: 'Skill' };
  const editing = !!dialog?.id;

  return (
    <>
      <Card
        title="Education"
        note={highest ? `Highest qualification: ${degreeLabel(highest.degree)}` : undefined}
        right={
          <button type="button" onClick={() => openEducation(null)} className={LINK_BTN}>
            + Add
          </button>
        }
      >
        {education.length === 0 && <Empty>No education entries yet.</Empty>}
        <ul className="mt-3 divide-y divide-slate-100">
          {education.map(ed => (
            <li key={ed.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-ink">{degreeLabel(ed.degree)}</span>
                {(ed.institution || ed.board_university || ed.year) && (
                  <span className="text-slate-500"> — {[ed.institution, ed.board_university, formatPassingYear(ed)].filter(Boolean).join(', ')}</span>
                )}
              </div>
              <div className="flex shrink-0 gap-3">
                <button type="button" onClick={() => openEducation(ed)} aria-label={`Edit ${degreeLabel(ed.degree)}`} className={LINK_BTN}>
                  Edit
                </button>
                <button type="button" onClick={() => remove('employee_education', ed.id, 'this education entry')} aria-label={`Remove ${degreeLabel(ed.degree)}`} className={DANGER_BTN}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Training & Certification"
        right={
          training ? (
            <button type="button" onClick={() => openTraining(null)} className={LINK_BTN}>
              + Add
            </button>
          ) : undefined
        }
      >
        {training === null ? (
          <Unavailable />
        ) : (
          <>
            {training.length === 0 && <Empty>No training recorded yet.</Empty>}
            <ul className="mt-3 divide-y divide-slate-100">
              {training.map(t => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{t.title}</span>
                    {t.provider && <span className="text-slate-500"> — {t.provider}</span>}
                    {(t.start_date || t.end_date) && (
                      <div className="text-xs text-slate-400">
                        {date(t.start_date)}
                        {t.end_date ? ` – ${date(t.end_date)}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-3">
                    <button type="button" onClick={() => openTraining(t)} aria-label={`Edit ${t.title}`} className={LINK_BTN}>
                      Edit
                    </button>
                    <button type="button" onClick={() => remove('employee_training', t.id, `"${t.title}"`)} aria-label={`Remove ${t.title}`} className={DANGER_BTN}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card
        title="Work Experience"
        right={
          <button type="button" onClick={() => openExperience(null)} className={LINK_BTN}>
            + Add
          </button>
        }
      >
        {summary.total > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <div className="-mb-px -mr-px grid grid-cols-2 text-sm sm:grid-cols-3">
              {[
                ['Before joining', formatDuration(summary.previous), false],
                ['With this company', formatDuration(summary.here), false],
                ['Total work experience', formatDuration(summary.total), true],
              ].map(([label, value, strong]) => (
                <div key={label as string} className="bg-white p-3 shadow-[inset_-1px_-1px_0_#e2e8f0]">
                  <span className="block text-xs text-slate-400">{label}</span>
                  <span className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {experience.length === 0 && <Empty>No work experience entries yet.</Empty>}
        <ul className="mt-3 divide-y divide-slate-100">
          {experience.map(exp => {
            const span = tenureDays(exp.start_date, exp.end_date);
            return (
              <li key={exp.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{exp.employer}</span>
                    {exp.role && <span className="text-slate-500"> — {exp.role}</span>}
                  </div>
                  <div className="flex shrink-0 gap-3">
                    <button type="button" onClick={() => openExperience(exp)} aria-label={`Edit ${exp.role || exp.employer}`} className={LINK_BTN}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove('employee_work_experience', exp.id, 'this work experience entry')}
                      aria-label={`Remove ${exp.role || exp.employer}`}
                      className={DANGER_BTN}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {exp.description && <p className="mt-1 text-xs text-slate-500">{exp.description}</p>}
                {(exp.start_date || exp.end_date) && (
                  <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {date(exp.start_date)} – {exp.end_date ? date(exp.end_date) : 'Present'}
                    </span>
                    {span !== null && <span>{span} days</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        title="Skills"
        right={
          <button type="button" onClick={openSkill} className={LINK_BTN}>
            + Add
          </button>
        }
      >
        <div className="mt-3 flex flex-wrap gap-2">
          {employee.skills.map(skill => (
            <span key={skill} className="flex items-center gap-1 rounded-full bg-good-bg px-3 py-1 text-xs font-medium text-good-text">
              {skill}
              <button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`} className="px-0.5 text-good-text/60 hover:text-good-text">
                ×
              </button>
            </span>
          ))}
          {employee.skills.length === 0 && <p className="text-xs text-slate-400">No skills added yet.</p>}
        </div>
        {skillError && (
          <p role="alert" className="mt-2 text-xs font-semibold text-critical-text">
            {skillError}
          </p>
        )}
      </Card>

      {dialog && (
        <FormDialog
          title={`${editing ? 'Edit' : 'Add'} ${titles[dialog.kind]}`}
          onSubmit={save}
          onClose={close}
          saving={saving}
          savingLabel="Saving…"
          submitLabel={editing ? 'Save' : 'Add'}
          error={error}
        >
          {dialog.kind === 'education' && (
            <>
              <label htmlFor="edu-degree" className={LABEL}>
                Degree
              </label>
              <select
                id="edu-degree"
                required
                value={educationForm.degree}
                onChange={e => setEducationForm(f => ({ ...f, degree: e.target.value }))}
                className={`${INPUT} mb-3 bg-white`}
              >
                <option value="" disabled>
                  Select degree
                </option>
                <option value="Under SEE">Under SEE</option>
                <option value="SEE">SEE</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Bachelors">Bachelors</option>
                <option value="Masters">Masters</option>
              </select>
              <label htmlFor="edu-institution" className={LABEL}>
                Institution
              </label>
              <input id="edu-institution" value={educationForm.institution} onChange={e => setEducationForm(f => ({ ...f, institution: e.target.value }))} className={`${INPUT} mb-3`} />
              <label htmlFor="edu-board" className={LABEL}>
                Board / university
              </label>
              <input
                id="edu-board"
                value={educationForm.board_university}
                onChange={e => setEducationForm(f => ({ ...f, board_university: e.target.value }))}
                placeholder="e.g. NEB, Tribhuvan University"
                className={`${INPUT} mb-3`}
              />
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div>
                  <label htmlFor="edu-year" className={LABEL}>
                    Passing year
                  </label>
                  <input id="edu-year" type="number" value={educationForm.year} onChange={e => setEducationForm(f => ({ ...f, year: e.target.value }))} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="edu-cal" className={LABEL}>
                    Calendar
                  </label>
                  <select id="edu-cal" value={educationForm.year_calendar} onChange={e => setEducationForm(f => ({ ...f, year_calendar: e.target.value }))} className={`${INPUT} bg-white`}>
                    <option value="AD">AD</option>
                    <option value="BS">BS</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {dialog.kind === 'training' && (
            <>
              <label htmlFor="tr-title" className={LABEL}>
                Course or certificate
              </label>
              <input id="tr-title" required value={trainingForm.title} onChange={e => setTrainingForm(f => ({ ...f, title: e.target.value }))} className={`${INPUT} mb-3`} />
              <label htmlFor="tr-provider" className={LABEL}>
                Provider
              </label>
              <input id="tr-provider" value={trainingForm.provider} onChange={e => setTrainingForm(f => ({ ...f, provider: e.target.value }))} className={`${INPUT} mb-3`} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Start date</label>
                  <DatePicker value={trainingForm.start_date} onChange={v => setTrainingForm(f => ({ ...f, start_date: v }))} ariaLabel="Start date" />
                </div>
                <div>
                  <label className={LABEL}>End date</label>
                  <DatePicker value={trainingForm.end_date} onChange={v => setTrainingForm(f => ({ ...f, end_date: v }))} ariaLabel="End date" />
                </div>
              </div>
            </>
          )}

          {dialog.kind === 'experience' && (
            <>
              <label htmlFor="exp-employer" className={LABEL}>
                Employer
              </label>
              <input id="exp-employer" required value={experienceForm.employer} onChange={e => setExperienceForm(f => ({ ...f, employer: e.target.value }))} className={`${INPUT} mb-3`} />
              <label htmlFor="exp-role" className={LABEL}>
                Role
              </label>
              <input id="exp-role" value={experienceForm.role} onChange={e => setExperienceForm(f => ({ ...f, role: e.target.value }))} className={`${INPUT} mb-3`} />
              <label htmlFor="exp-description" className={LABEL}>
                Description
              </label>
              <textarea
                id="exp-description"
                value={experienceForm.description}
                onChange={e => setExperienceForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Start date</label>
                  <DatePicker value={experienceForm.start_date} onChange={v => setExperienceForm(f => ({ ...f, start_date: v }))} ariaLabel="Start date" />
                </div>
                <div>
                  <label className={LABEL}>End date</label>
                  <DatePicker value={experienceForm.end_date} onChange={v => setExperienceForm(f => ({ ...f, end_date: v }))} ariaLabel="End date" />
                </div>
              </div>
            </>
          )}

          {dialog.kind === 'skill' && (
            <>
              <label htmlFor="skill-category" className={LABEL}>
                Category
              </label>
              <select
                id="skill-category"
                value={skillCategory}
                onChange={e => setSkillCategory(e.target.value as (typeof SKILL_CATEGORIES)[number])}
                className={`${INPUT} mb-3 bg-white`}
              >
                {SKILL_CATEGORIES.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label htmlFor="skill-value" className={LABEL}>
                Skill
              </label>
              <input
                id="skill-value"
                autoFocus
                required
                value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                placeholder="e.g. English, Forklift license…"
                className={INPUT}
              />
            </>
          )}
        </FormDialog>
      )}
    </>
  );
}
