// The paper form customers fill in, for the "Print a blank form" button. It is on the page all the time but
// hidden on screen; when the page is printed the rest of the page is hidden instead (print:hidden on the
// page's other content, and the sidebar and top bar already hide themselves), so only this prints, on one A4 page.
// Black and white with plain lines, so it prints the same on any printer. It asks exactly what the page types in
// (who served, the date, the day of the visit, what it was for, the guest's name, phone and email, a 1-5 rating, a 0-10
// would-recommend number and a comment), in the same order. Written for any company: "customer". The guest's details are optional.

const circle = 'flex shrink-0 items-center justify-center rounded-full border-[1.8px] border-black font-bold';
const label = 'text-[12px] font-bold';
const fieldLine = 'h-7 border-b-[1.5px] border-black';
const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** One numbered question in its own box. */
function Question({ n, title, hint, children }: { n: number; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 break-inside-avoid rounded-xl border-[1.5px] border-black px-6 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.8px] border-black text-[13px] font-extrabold">{n}</span>
        <div>
          <div className="text-[17px] font-extrabold leading-snug">{title}</div>
          <div className="mt-0.5 text-[12px]">{hint}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function BlankFeedbackForm({ companyName }: { companyName: string }) {
  return (
    <div aria-hidden="true" className="mx-auto hidden w-full max-w-[794px] bg-white px-2 py-1 text-black print:block">
      <div className="flex items-end justify-between gap-4 border-b-[3px] border-black pb-3">
        <div className="text-[28px] font-extrabold leading-none tracking-tight">{companyName || ' '}</div>
        <div className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.2em]">Feedback form</div>
      </div>

      <h1 className="m-0 mt-5 text-[32px] font-extrabold leading-tight">Tell us how we did</h1>
      <p className="m-0 mt-1 text-[14.5px] leading-relaxed">Thank you for your time. It takes about a minute.</p>

      <section className="mt-4 break-inside-avoid rounded-xl border-[1.5px] border-black px-6 py-4">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em]">About your visit</div>
        <div className="mt-3 grid grid-cols-[1.3fr_1fr] gap-x-7">
          <div>
            <div className={label}>Who served you?</div>
            <div className={fieldLine} />
          </div>
          <div>
            <div className={label}>Date</div>
            <div className={fieldLine} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-[1.3fr_1fr] gap-x-7">
          <div>
            <div className={label}>
              What was it for? <span className="font-medium">(optional)</span>
            </div>
            <div className={fieldLine} />
          </div>
          <div>
            <div className={label}>Date of visit</div>
            <div className={fieldLine} />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-[1.3fr_1fr] gap-x-7">
          <div>
            <div className={label}>
              Your name <span className="font-medium">(optional)</span>
            </div>
            <div className={fieldLine} />
          </div>
          <div>
            <div className={label}>
              Phone <span className="font-medium">(optional)</span>
            </div>
            <div className={fieldLine} />
          </div>
        </div>
        <div className="mt-3">
          <div className={label}>
            Email <span className="font-medium">(optional)</span>
          </div>
          <div className={fieldLine} />
        </div>
      </section>

      <Question n={1} title="How was the service you received?" hint="Circle one number.">
        <div className="mt-3 flex justify-between px-3">
          {[1, 2, 3, 4, 5].map(n => (
            <div key={n} className="flex w-[72px] flex-col items-center">
              <div className={`${circle} h-[46px] w-[46px] text-lg`}>{n}</div>
              <span className="mt-1 text-[12px]">{RATING_WORDS[n - 1]}</span>
            </div>
          ))}
        </div>
      </Question>

      <Question n={2} title="How likely are you to recommend us to a friend or family member?" hint="Circle one number.">
        <div className="mt-3 flex justify-between">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
            <div key={n} className={`${circle} h-[42px] w-[42px] text-base`}>
              {n}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[12px]">
          <span>Not at all likely</span>
          <span>Extremely likely</span>
        </div>
      </Question>

      <Question n={3} title="Anything else you would like to tell us?" hint="Optional.">
        <div className="mt-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-[34px] border-b border-slate-500" />
          ))}
        </div>
      </Question>

      <div className="mt-5 border-t-[1.5px] border-black pt-3 text-[13px] leading-relaxed">
        Thank you. Please hand this form to our team or put it in the box.
      </div>
    </div>
  );
}
