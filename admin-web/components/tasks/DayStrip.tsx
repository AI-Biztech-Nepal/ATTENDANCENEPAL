import { DAY_END_HOUR, DAY_START_HOUR, SLOT_HOURS, formatHour, type Placement, type Slot } from '@/lib/taskSchedule';
import { BLOCK_TONE } from './taskStyles';

/** One employee's working day as nine small cells, 9 AM to 6 PM: booked hours tinted by the task's status,
 * free hours blank. `extra` draws a slot that is about to be booked (dashed), red when it would overlap. */
export default function DayStrip({
  placements,
  extra,
  extraClashes = false,
  label,
  showHours = false,
}: {
  placements: Placement[];
  extra?: Slot | null;
  extraClashes?: boolean;
  /** What a screen reader hears for the whole strip. */
  label: string;
  /** Hour numbers under the cells (the dialog shows them; the phone cards just show 9 AM / 6 PM). */
  showHours?: boolean;
}) {
  const covered = new Set<number>();
  for (const p of placements) for (let c = p.colStart; c < p.colStart + p.span; c++) covered.add(c);

  let extraStyle: { gridColumn: string } | null = null;
  if (extra) {
    const first = Math.max(Math.floor(extra.start), DAY_START_HOUR);
    const last = Math.min(Math.ceil(extra.end), DAY_END_HOUR);
    if (last > first) extraStyle = { gridColumn: `${first - DAY_START_HOUR + 1} / span ${last - first}` };
  }

  return (
    <div>
      <div role="img" aria-label={label} className="grid h-[18px] grid-cols-9 gap-0.5">
        {SLOT_HOURS.map(h => {
          const col = h - DAY_START_HOUR + 1;
          return covered.has(col) ? null : (
            <div key={`free-${h}`} style={{ gridColumn: col, gridRow: 1 }} className="rounded border border-slate-200 bg-white" />
          );
        })}
        {placements.map(p => (
          <div
            key={p.task.id}
            style={{ gridColumn: `${p.colStart} / span ${p.span}`, gridRow: 1 }}
            className={`rounded border ${BLOCK_TONE[p.task.status].box}`}
          />
        ))}
        {extraStyle && (
          <div
            style={{ ...extraStyle, gridRow: 1 }}
            className={`rounded border-2 border-dashed ${extraClashes ? 'border-rose-600 bg-rose-100' : 'border-teal-700 bg-teal-100'}`}
          />
        )}
      </div>
      {showHours ? (
        <div aria-hidden="true" className="mt-1 grid grid-cols-9 gap-0.5 text-center text-[11px] text-slate-600">
          {SLOT_HOURS.map(h => (
            <span key={h}>{formatHour(h)}</span>
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] text-slate-600">
          <span>9 AM</span>
          <span>6 PM</span>
        </div>
      )}
    </div>
  );
}
