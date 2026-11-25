import { columnsOf, formatHour, formatHourShort, hoursOf, type DayRange, type Placement, type Slot } from '@/lib/taskSchedule';
import { BLOCK_TONE } from './taskStyles';

/** One employee's working day as a row of small cells (two for every hour, so half hours show), over the hours the timetable covers:
 * booked time tinted by the task's status, free time blank. `extra` draws a slot that is about to be booked (dashed), red when it
 * would overlap. */
export default function DayStrip({
  range,
  placements,
  extra,
  extraClashes = false,
  label,
  showHours = false,
}: {
  /** The hours the strip covers (the timetable's). */
  range: DayRange;
  placements: Placement[];
  extra?: Slot | null;
  extraClashes?: boolean;
  /** What a screen reader hears for the whole strip. */
  label: string;
  /** Hour numbers under the cells (the dialog shows them; the phone cards just show the first and last hour). */
  showHours?: boolean;
}) {
  const cols = columnsOf(range);
  const covered = new Set<number>();
  for (const p of placements) for (let c = p.colStart; c < p.colStart + p.span; c++) covered.add(c);

  let extraStyle: { gridColumn: string } | null = null;
  if (extra) {
    const first = Math.max(Math.floor(extra.start * 2) / 2, range.start);
    const last = Math.min(Math.ceil(extra.end * 2) / 2, range.end);
    if (last > first) extraStyle = { gridColumn: `${Math.round((first - range.start) * 2) + 1} / span ${Math.round((last - first) * 2)}` };
  }

  const hours = hoursOf(range);
  // A long day has too many hours to name each one: every second hour then.
  const every = hours.length > 12 ? 2 : 1;

  return (
    <div>
      <div role="img" aria-label={label} className="grid h-[18px] gap-px" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }, (_, i) => i + 1).map(col =>
          covered.has(col) ? null : <div key={`free-${col}`} style={{ gridColumn: col, gridRow: 1 }} className="rounded-[2px] border border-slate-200 bg-white" />
        )}
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
        <div aria-hidden="true" className="mt-1 grid gap-px text-center text-[11px] text-slate-600" style={{ gridTemplateColumns: `repeat(${hours.length}, minmax(0, 1fr))` }}>
          {hours.map((h, i) => (
            <span key={h} className="overflow-visible whitespace-nowrap">
              {i % every === 0 ? formatHour(h) : ''}
            </span>
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] text-slate-600">
          <span>{formatHourShort(range.start)}</span>
          <span>{formatHourShort(range.end)}</span>
        </div>
      )}
    </div>
  );
}
