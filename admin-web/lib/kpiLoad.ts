// Reading the KPI numbers from the database, and saying so when a read fails. A table that is not there yet (a migration
// that has not been run) or a refused read used to look exactly like "no data yet": a dash. These helpers keep the first
// problem so the pages can say it out loud, and never confuse "nothing there" with "could not read".

const PAGE = 1000;

/** What a failed read looks like from Supabase. */
type DbError = { message?: string; code?: string } | null;

/**
 * Every row of a query, a page at a time (PostgREST caps a request), and the first problem if a page could not be read.
 * Unlike fetchAll it does not swallow the error: `rows` holds what was read before it, and `error` holds the problem.
 */
export async function fetchAllChecked<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>,
  what: string,
  migration?: string
): Promise<{ rows: T[]; error: string }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error: loadProblem(what, error, migration) };
    if (!Array.isArray(data)) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return { rows, error: '' };
}

/** True when the table is not there at all (its migration has not been run), as opposed to a table that refused the read. */
export const isMissingTable = (e: DbError) => !!e && /PGRST205|42P01|schema cache|does not exist|could not find the table/i.test(`${e.code ?? ''} ${e.message ?? ''}`);

/** A sentence for a failed read. `what` is a short noun phrase ("the services data"); `migration` names the file that
 * creates the table, for the common case that it has not been run. */
export function loadProblem(what: string, e: DbError, migration?: string): string {
  if (!e) return '';
  if (isMissingTable(e)) {
    return `${what.charAt(0).toUpperCase()}${what.slice(1)} is not set up in the database yet${migration ? ` (run ${migration})` : ''}.`;
  }
  return `Could not load ${what}: ${e.message || 'the database did not say why'}.`;
}

/** The distinct problems, in order, skipping empty ones. */
export const problemsOf = (...errors: string[]) => [...new Set(errors.filter(Boolean))];

/** The migration that creates each table the KPIs read, for the messages. */
export const MIGRATION = {
  services: '20261122180000_service_import.sql',
  forms: '20261122140000_customer_feedback.sql',
  reviews: '20261123140000_colleague_feedback.sql',
  own: '20261123120000_own_kpis.sql',
  mine: '20261123160000_employee_kpi_read.sql',
  guests: '20261124120000_customer_feedback_guest_details.sql',
  names: '20261125120000_feedback_names.sql',
} as const;
