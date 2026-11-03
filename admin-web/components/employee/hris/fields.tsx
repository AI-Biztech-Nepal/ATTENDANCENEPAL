'use client';

import type { ReactNode } from 'react';
import DatePicker from '@/components/DatePicker';
import { NEPAL_PROVINCES } from '@/lib/employeeProfile';

// The fields inside the employee pages' edit pop-ups. Same behaviour as the admin's
// (an "Edited" tag and a coloured edge on a field that differs from what is saved),
// in the employee pages' look.

const FIELD = 'h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-medium';
const EDITED = 'border-2 border-brand px-[11px] ring-2 ring-emerald-100';
const LABEL = 'mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-600';

function EditedTag() {
  return <span className="rounded-full bg-[#ffedd5] px-[7px] py-px text-[10px] font-extrabold text-[#c2410c]">Edited</span>;
}

/** The fields of one pop-up, in as many columns as fit. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-x-5 gap-y-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      {children}
    </div>
  );
}

export function GroupHeading({ children }: { children: ReactNode }) {
  return <h3 className="col-span-full -mb-2 mt-1 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-600">{children}</h3>;
}

export function TextField({
  label,
  value,
  onChange,
  edited,
  type = 'text',
  placeholder,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  edited?: boolean;
  type?: string;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <label className={`block min-w-0 ${wide ? 'col-span-full' : ''}`}>
      <span className={LABEL}>
        {label}
        {edited && <EditedTag />}
      </span>
      <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={`${FIELD} ${edited ? EDITED : ''}`} />
    </label>
  );
}

export function SelectField({ label, value, onChange, edited, children }: { label: string; value: string; onChange: (value: string) => void; edited?: boolean; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className={LABEL}>
        {label}
        {edited && <EditedTag />}
      </span>
      <select value={value} onChange={e => onChange(e.target.value)} className={`${FIELD} bg-white ${edited ? EDITED : ''}`}>
        {children}
      </select>
    </label>
  );
}

export function DateField({ label, value, onChange, edited }: { label: string; value: string; onChange: (value: string) => void; edited?: boolean }) {
  return (
    <div className="min-w-0">
      <span className={LABEL}>
        {label}
        {edited && <EditedTag />}
      </span>
      <DatePicker value={value} onChange={onChange} ariaLabel={label} className={edited ? 'ring-2 ring-brand' : ''} />
    </div>
  );
}

/** A few choices as buttons. Pressing the chosen one again clears it. */
export function SegmentField({
  label,
  value,
  options,
  onChange,
  edited,
  tone = 'default',
  wide,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  edited?: boolean;
  tone?: 'default' | 'danger';
  wide?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={wide ? 'col-span-full' : 'min-w-0'}>
      <span className={LABEL}>
        {label}
        {edited && <EditedTag />}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = o.value === value;
          const look = on
            ? tone === 'danger'
              ? 'border-2 border-[#9f1239] bg-[#fee2e2] text-[#b91c1c]'
              : 'border-2 border-brand bg-brand-light text-[#065f46]'
            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50';
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? '' : o.value)}
              className={`h-11 rounded-xl px-4 text-[13px] font-extrabold ${tone === 'danger' ? 'min-w-[52px]' : ''} ${look}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Province, district, municipality, ward and tole of one address. `form` is the whole pop-up's values. */
export function AddressFields({
  kind,
  form,
  setField,
  isEdited,
}: {
  kind: 'permanent' | 'temporary';
  form: Record<string, string>;
  setField: (key: string) => (value: string) => void;
  isEdited: (key: string) => boolean;
}) {
  const province = form[`${kind}_province`] ?? '';
  const k = (part: string) => `${kind}_${part}`;
  return (
    <>
      <SelectField label="Province" value={province} onChange={setField(k('province'))} edited={isEdited(k('province'))}>
        <option value="">Not set</option>
        {province && !(NEPAL_PROVINCES as readonly string[]).includes(province) && <option value={province}>{province}</option>}
        {NEPAL_PROVINCES.map(p => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </SelectField>
      <TextField label="District" value={form[k('district')] ?? ''} onChange={setField(k('district'))} edited={isEdited(k('district'))} />
      <TextField label="Municipality" value={form[k('municipality')] ?? ''} onChange={setField(k('municipality'))} edited={isEdited(k('municipality'))} />
      <TextField label="Ward no." value={form[k('ward')] ?? ''} onChange={setField(k('ward'))} edited={isEdited(k('ward'))} />
      <TextField label="Tole" value={form[k('tole')] ?? ''} onChange={setField(k('tole'))} edited={isEdited(k('tole'))} />
    </>
  );
}
