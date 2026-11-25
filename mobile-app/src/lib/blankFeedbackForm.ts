// The paper form customers fill in, for the "Print a blank form" button: black and white with plain lines, so it prints the same on any
// printer, on one A4 page. It asks exactly what the Customer feedback section types in (who served, the date of the visit, the guest's name
// and phone and email, what it was for, a 1-5 rating, a 0-10 would-recommend number and a comment). The email and what it was for are
// optional. Same form as admin-web/components/kpi/BlankFeedbackForm.tsx, written as HTML for expo-print.

const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const line = (label: string, optional = false) => `<div><div class="label">${label}${optional ? ' <span class="opt">(optional)</span>' : ''}</div><div class="line"></div></div>`;

const question = (n: number, title: string, hint: string, body: string) =>
  `<section class="box q"><div class="qhead"><span class="num">${n}</span><div><div class="qtitle">${title}</div><div class="hint">${hint}</div></div></div>${body}</section>`;

export function blankFeedbackFormHtml(companyName: string): string {
  const ratings = [1, 2, 3, 4, 5].map(n => `<div class="rate"><div class="circle big">${n}</div><span>${RATING_WORDS[n - 1]}</span></div>`).join('');
  const recommend = Array.from({ length: 11 }, (_, n) => `<div class="circle">${n}</div>`).join('');
  const lines = [0, 1, 2, 3].map(() => '<div class="rule"></div>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #000; padding-bottom: 10px; }
  .co { font-size: 26px; font-weight: 800; }
  .tag { font-size: 11px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase; }
  h1 { font-size: 30px; margin: 18px 0 2px; }
  p { margin: 0; font-size: 14px; }
  .box { border: 1.5px solid #000; border-radius: 12px; padding: 14px 20px; margin-top: 14px; break-inside: avoid; }
  .eyebrow { font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
  .grid { display: grid; grid-template-columns: 1.3fr 1fr; column-gap: 24px; margin-top: 10px; }
  .label { font-size: 12px; font-weight: 700; }
  .opt { font-weight: 500; }
  .line { height: 26px; border-bottom: 1.5px solid #000; }
  .qhead { display: flex; gap: 12px; align-items: flex-start; }
  .num { width: 26px; height: 26px; border: 1.8px solid #000; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; flex: none; }
  .qtitle { font-size: 16px; font-weight: 800; }
  .hint { font-size: 12px; margin-top: 2px; }
  .row { display: flex; justify-content: space-between; margin-top: 12px; }
  .circle { width: 40px; height: 40px; border: 1.8px solid #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
  .circle.big { width: 46px; height: 46px; font-size: 18px; }
  .rate { display: flex; flex-direction: column; align-items: center; width: 70px; font-size: 12px; gap: 4px; }
  .ends { display: flex; justify-content: space-between; font-size: 12px; margin-top: 6px; }
  .rule { height: 32px; border-bottom: 1px solid #64748b; }
  .thanks { margin-top: 18px; border-top: 1.5px solid #000; padding-top: 10px; font-size: 13px; }
</style></head><body>
<div class="top"><div class="co">${escapeHtml(companyName) || '&nbsp;'}</div><div class="tag">Feedback form</div></div>
<h1>Tell us how we did</h1>
<p>Thank you for your time. It takes about a minute.</p>
<section class="box"><div class="eyebrow">About your visit</div>
  <div class="grid">${line('Who served you?')}${line('Date of visit')}</div>
  <div class="grid">${line('Your name')}${line('Phone')}</div>
  <div class="grid">${line('Email', true)}${line('What was it for?', true)}</div>
</section>
${question(1, 'How was the service you received?', 'Circle one number.', `<div class="row" style="padding:0 10px">${ratings}</div>`)}
${question(2, 'How likely are you to recommend us to a friend or family member?', 'Circle one number.', `<div class="row">${recommend}</div><div class="ends"><span>Not at all likely</span><span>Extremely likely</span></div>`)}
${question(3, 'Anything else you would like to tell us?', 'Optional.', `<div style="margin-top:6px">${lines}</div>`)}
<div class="thanks">Thank you. Please hand this form to our team or put it in the box.</div>
</body></html>`;
}
