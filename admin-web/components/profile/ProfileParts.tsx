'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import Avatar from '@/components/Avatar';

/** One labelled fact: a small grey label over a bold value; empty shows a dash. */
export function Fact({ label, children, wide }: { label: string; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-full' : ''}`}>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-semibold text-ink">{children || '—'}</dd>
    </div>
  );
}

/** Facts laid out in as many columns as fit, so a card reads well from phone to wide desktop. */
export function FactGrid({ children, min = 170 }: { children: ReactNode; min?: number }) {
  return (
    <dl className="mt-4 grid gap-x-5 gap-y-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>
      {children}
    </dl>
  );
}

export function ProfileCard({
  title,
  action,
  onAction,
  tone = 'default',
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border bg-white p-5 ${tone === 'danger' ? 'border-rose-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-extrabold text-ink">{title}</h2>
        {action && onAction && (
          <button type="button" onClick={onAction} className="text-[13px] font-extrabold text-accent hover:underline">
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export type ProfileTab = { id: string; label: string; badge?: { text: string; tone: 'warn' | 'good' | 'muted' } };

const BADGE_TONE = {
  warn: 'bg-warning-bg text-warning-text',
  good: 'bg-good-bg text-good-text',
  muted: 'bg-slate-100 text-slate-600',
} as const;

/** Underlined section tabs. All panels stay mounted (the page only hides the inactive ones),
 * so a half-filled form is still there when you come back to it. */
export function ProfileTabs({ tabs, active, onChange }: { tabs: ProfileTab[]; active: string; onChange: (id: string) => void }) {
  return (
    <nav aria-label="Profile sections" className="mb-5 flex flex-wrap gap-x-7 gap-y-1 border-b border-slate-200">
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-current={on ? 'page' : undefined}
            className={`-mb-px flex items-center gap-2 border-b-[3px] px-0.5 py-3 text-sm font-extrabold ${
              on ? 'border-accent text-emerald-800' : 'border-transparent text-slate-600 hover:text-ink'
            }`}
          >
            {t.label}
            {t.badge && <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${BADGE_TONE[t.badge.tone]}`}>{t.badge.text}</span>}
          </button>
        );
      })}
    </nav>
  );
}

/** The thing someone needs in a hurry: blood group and who to call. */
export function EmergencyCard({
  bloodGroup,
  name,
  relationship,
  phone,
  address,
  onEdit,
}: {
  bloodGroup: string | null | undefined;
  name: string | null;
  relationship: string | null;
  phone: string | null;
  address: string | null | undefined;
  onEdit: () => void;
}) {
  const hasContact = !!(name || phone);
  return (
    <ProfileCard title="Emergency" action="Edit" onAction={onEdit} tone="danger">
      <div className="mt-4 flex items-center gap-4">
        <div
          className={`flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-2xl ${
            bloodGroup ? 'bg-critical-bg text-critical-text' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <span className="text-[28px] font-extrabold leading-none">{bloodGroup || '—'}</span>
          <span className="mt-1 text-[11px] font-extrabold">Blood group</span>
        </div>
        <div className="min-w-0">
          {hasContact ? (
            <>
              {name && <p className="text-[15px] font-extrabold text-ink">{name}</p>}
              {(relationship || address) && <p className="mt-0.5 text-[13px] font-semibold text-slate-600">{[relationship, address].filter(Boolean).join(' · ')}</p>}
              {phone && (
                <a href={`tel:${phone}`} className="mt-2 inline-flex items-center gap-2 text-sm font-extrabold text-emerald-800 hover:underline">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
                  </svg>
                  {phone}
                </a>
              )}
            </>
          ) : (
            <p className="text-sm font-semibold text-slate-600">No emergency contact on file yet.</p>
          )}
        </div>
      </div>
    </ProfileCard>
  );
}

export type AttentionItem = { key: string; title: string; detail?: string; action?: { label: string; onClick: () => void } };

/** What needs doing for this person — contract, missing documents, open records, an unfinished exit. */
export function AttentionCard({ items }: { items: AttentionItem[] }) {
  return (
    <ProfileCard title="Needs attention">
      {items.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-600">Nothing needs attention right now.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {items.map(it => (
            <li key={it.key} className="flex items-start gap-3">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
                <strong className="font-extrabold">{it.title}</strong>
                {it.detail && <span className="block text-[13px] font-semibold text-slate-600">{it.detail}</span>}
              </span>
              {it.action && (
                <button type="button" onClick={it.action.onClick} className="shrink-0 text-[13px] font-extrabold text-accent hover:underline">
                  {it.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </ProfileCard>
  );
}

/** How many of the document kinds are on file, and which are still missing. */
export function DocumentProgress({ have, total, missing, onOpen }: { have: number; total: number; missing: string[]; onOpen: () => void }) {
  const pct = total === 0 ? 0 : Math.round((have / total) * 100);
  return (
    <ProfileCard title="Documents" action="Open" onAction={onOpen}>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[26px] font-extrabold text-ink">{have}</span>
        <span className="text-sm font-bold text-slate-500">of {total} on file</span>
      </div>
      <div role="img" aria-label={`${have} of ${total} documents uploaded`} className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {missing.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {missing.slice(0, 4).map(m => (
            <span key={m} className="rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-extrabold text-warning-text">
              {m}
            </span>
          ))}
          {missing.length > 4 && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-extrabold text-slate-600">+{missing.length - 4} more</span>}
        </div>
      )}
    </ProfileCard>
  );
}

const RING_SIZE = 112;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** A ring around the profile photo showing how much of the document checklist is on file:
 * teal and closed when every kind is there, orange and part-filled while some are missing.
 * `have` is null until the count is known (or when it can't be read) — then there is no ring. */
export function DocumentRing({ have, total, onOpen, children }: { have: number | null; total: number; onOpen: () => void; children: ReactNode }) {
  const known = have !== null && total > 0;
  const complete = known && have >= total;
  const label = known ? (complete ? `All ${total} documents on file` : `${have} of ${total} documents on file — ${total - have} missing`) : undefined;
  return (
    <div className="relative flex shrink-0 items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }} title={label}>
      {known && (
        <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} className="stroke-slate-200" />
          {have > 0 && (
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${RING_LENGTH * Math.min(have / total, 1)} ${RING_LENGTH}`}
              className={`transition-[stroke-dasharray] duration-500 ${complete ? 'stroke-good' : 'stroke-warning'}`}
            />
          )}
        </svg>
      )}
      {children}
      {known && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${label}. Open documents`}
          className={`absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-white px-2 py-0.5 text-[11px] font-extrabold leading-none hover:brightness-95 ${
            complete ? 'bg-good-bg text-good-text' : 'bg-warning-bg text-warning-text'
          }`}
        >
          {complete && (
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          )}
          {have}/{total}
        </button>
      )}
    </div>
  );
}

export function ReportingLine({
  manager,
  directReports,
}: {
  manager: { id: string; name: string } | null;
  directReports: { id: string; name: string }[] | null;
}) {
  return (
    <ProfileCard title="Reporting line">
      {manager ? (
        <Link href={`/employees/${manager.id}`} className="mt-4 flex items-center gap-3 hover:opacity-80">
          <Avatar name={manager.name} photoUrl={null} className="h-10 w-10 text-sm" />
          <span className="min-w-0">
            <span className="block text-sm font-extrabold text-ink">{manager.name}</span>
            <span className="block text-xs font-semibold text-slate-500">Reports to</span>
          </span>
        </Link>
      ) : (
        <p className="mt-3 text-sm font-semibold text-slate-600">Reports to no one.</p>
      )}
      {directReports && (
        <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
          {directReports.length === 0 ? (
            <p className="font-semibold text-slate-600">No direct reports.</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-slate-500">
                {directReports.length} direct report{directReports.length === 1 ? '' : 's'}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {directReports.slice(0, 5).map(r => (
                  <li key={r.id}>
                    <Link href={`/employees/${r.id}`} className="font-bold text-accent hover:underline">
                      {r.name}
                    </Link>
                  </li>
                ))}
                {directReports.length > 5 && <li className="text-xs font-semibold text-slate-500">and {directReports.length - 5} more</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </ProfileCard>
  );
}
