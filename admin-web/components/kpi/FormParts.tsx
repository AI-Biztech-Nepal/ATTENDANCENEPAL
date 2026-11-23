// The pieces the two review forms share, so they look and read the same: the customer form that staff type in from paper
// (FeedbackFields) and the colleague feedback form a person fills in themselves (GiveFeedbackDialog). Each is a list of numbered
// questions in boxes, answered with round numbers that have a word under them, like the paper form.

/** One numbered question of a form, in a box like the paper's. The title is a label for the box it points to (`htmlFor`), or a
 * heading for a group of buttons (give it an `id` and point the group at it with aria-labelledby). */
export function Question({ n, htmlFor, id, title, range, children }: { n: number; htmlFor?: string; id?: string; title: string; range?: string; children: React.ReactNode }) {
  const className = 'mb-2.5 flex items-start gap-2.5 text-[13px] font-extrabold leading-snug text-ink';
  const head = (
    <>
      <span aria-hidden="true" className="mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ink text-[11px] text-white">
        {n}
      </span>
      <span>
        {title} {range && <span className="font-medium text-slate-600">{range}</span>}
      </span>
    </>
  );
  return (
    <div className="mb-3.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} id={id} className={className}>
          {head}
        </label>
      ) : (
        <div id={id} className={className}>
          {head}
        </div>
      )}
      {children}
    </div>
  );
}

/** A round number to circle: filled when chosen, an outline otherwise. `size` is the circle's own size classes. */
export const circleClasses = (on: boolean, size = 'h-10 w-10 text-sm') =>
  `flex ${size} items-center justify-center rounded-full border font-extrabold tabular-nums transition-colors ${
    on ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-teal-700 hover:text-teal-700'
  }`;
