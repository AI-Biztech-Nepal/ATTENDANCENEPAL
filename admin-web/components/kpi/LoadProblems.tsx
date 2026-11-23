/** Says out loud that some KPI numbers could not be read from the database, instead of letting them look like "no data".
 * Shown above the numbers; nothing when everything was read. */
export default function LoadProblems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
      <div className="font-extrabold">Some numbers could not be read, so they are not shown.</div>
      <ul className="m-0 mt-1 list-disc pl-5">
        {problems.map(p => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
