// The paper form customers fill in, for the "Print a blank form" button. It is on the page all the time but
// hidden on screen; when the page is printed the rest of the page is hidden instead (print:hidden on the
// page's other content, and the sidebar and top bar already hide themselves), so only this prints, on A4.
// Written for any company: "customer", no names or phone numbers asked for.

const circle = 'flex items-center justify-center rounded-full border-[1.8px] border-black font-bold';

export default function BlankFeedbackForm({ companyName }: { companyName: string }) {
  return (
    <div aria-hidden="true" className="mx-auto hidden w-full max-w-[794px] bg-white px-4 py-2 text-black print:block">
      <div className="border-b-2 border-black pb-4 text-xl font-extrabold tracking-wide">{companyName || ' '}</div>

      <h1 className="m-0 mb-1.5 mt-7 text-3xl font-extrabold">Tell us how we did</h1>
      <p className="m-0 text-[15px] leading-relaxed">Thank you for your time. It takes about a minute.</p>

      <div className="mt-8 grid grid-cols-[1.3fr_1fr] gap-7">
        <div>
          <div className="text-[13px] font-bold">Who served you?</div>
          <div className="h-8 border-b-[1.5px] border-black" />
        </div>
        <div>
          <div className="text-[13px] font-bold">Date</div>
          <div className="h-8 border-b-[1.5px] border-black" />
        </div>
      </div>
      <div className="mt-5">
        <div className="text-[13px] font-bold">
          What was it for? <span className="font-medium">(optional)</span>
        </div>
        <div className="h-8 border-b-[1.5px] border-black" />
      </div>

      <div className="mt-9">
        <div className="text-[17px] font-extrabold leading-snug">1. How was the service you received?</div>
        <div className="mt-4 flex justify-between px-5">
          {[1, 2, 3, 4, 5].map(n => (
            <div key={n} className={`${circle} h-[46px] w-[46px] text-lg`}>
              {n}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between px-1.5 text-[12.5px]">
          <span>Poor</span>
          <span>Excellent</span>
        </div>
      </div>

      <div className="mt-9">
        <div className="text-[17px] font-extrabold leading-snug">2. How likely are you to recommend us to a friend or family member?</div>
        <div className="mt-4 flex justify-between">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
            <div key={n} className={`${circle} h-[42px] w-[42px] text-base`}>
              {n}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[12.5px]">
          <span>Not at all likely</span>
          <span>Extremely likely</span>
        </div>
      </div>

      <div className="mt-9">
        <div className="text-[17px] font-extrabold leading-snug">3. Anything else you would like to tell us?</div>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-[38px] border-b border-slate-400" />
        ))}
      </div>

      <div className="mt-10 border-t border-slate-300 pt-4 text-[13.5px] leading-relaxed">
        Thank you. Please hand this form to our team or put it in the box.
        <br />
        You do not need to write your name or phone number.
      </div>
    </div>
  );
}
