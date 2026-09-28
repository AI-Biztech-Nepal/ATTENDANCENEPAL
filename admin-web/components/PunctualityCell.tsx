import { formatHoursMinutes } from '@/lib/shift';

/** One side of a day's punctuality — the check-in OR the check-out — as a
 * single line: "Late Xh Ym", "Early Xh Ym", or "—". A punch is only ever
 * one of early / on-time / late, so at most one value is non-zero. */
export function TimingCell({
  earlyMinutes,
  lateMinutes,
  earlyClass,
  lateClass,
}: {
  earlyMinutes: number;
  lateMinutes: number;
  /** Tailwind text-colour class for the "Early …" state. */
  earlyClass: string;
  /** Tailwind text-colour class for the "Late …" state. */
  lateClass: string;
}) {
  if (lateMinutes > 0)
    return <span className={`font-medium ${lateClass}`}>Late {formatHoursMinutes(lateMinutes)}</span>;
  if (earlyMinutes > 0)
    return <span className={`font-medium ${earlyClass}`}>Early {formatHoursMinutes(earlyMinutes)}</span>;
  return <span className="text-slate-400 print:text-ink">—</span>;
}

/** A period total for one side — unlike a single day, a range can have BOTH
 * late and early minutes accumulated, so show whichever are non-zero. */
export function TimingTotal({
  earlyMinutes,
  lateMinutes,
  earlyClass,
  lateClass,
}: {
  earlyMinutes: number;
  lateMinutes: number;
  earlyClass: string;
  lateClass: string;
}) {
  if (lateMinutes <= 0 && earlyMinutes <= 0) return <span className="text-slate-400 print:text-ink">—</span>;
  return (
    <span className="flex flex-col gap-0.5 leading-tight">
      {lateMinutes > 0 && <span className={`font-medium ${lateClass}`}>Late {formatHoursMinutes(lateMinutes)}</span>}
      {earlyMinutes > 0 && <span className={`font-medium ${earlyClass}`}>Early {formatHoursMinutes(earlyMinutes)}</span>}
    </span>
  );
}

/** Both sides stacked with "In" / "Out" labels — for cramped layouts (the
 * phone breakdown table) that can't afford two separate columns. */
export default function TimingPair({
  lateMinutes,
  earlyArrivalMinutes,
  earlyMinutes,
  lateDepartureMinutes,
}: {
  lateMinutes: number;
  earlyArrivalMinutes: number;
  earlyMinutes: number;
  lateDepartureMinutes: number;
}) {
  return (
    <span className="flex flex-col gap-0.5 leading-tight">
      <span className="flex gap-1">
        <span className="text-slate-400 print:text-ink">In</span>
        <TimingCell
          lateMinutes={lateMinutes}
          earlyMinutes={earlyArrivalMinutes}
          lateClass="text-warning-text print:text-ink"
          earlyClass="text-good-text print:text-ink"
        />
      </span>
      <span className="flex gap-1">
        <span className="text-slate-400 print:text-ink">Out</span>
        <TimingCell
          lateMinutes={lateDepartureMinutes}
          earlyMinutes={earlyMinutes}
          lateClass="text-info-text print:text-ink"
          earlyClass="text-critical-text print:text-ink"
        />
      </span>
    </span>
  );
}
