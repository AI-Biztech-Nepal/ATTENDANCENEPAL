// The services KPIs (number of services performed, hour utilisation per day) now come from the Tasks page: see useTaskKpi.ts.
// What stays here is the month range the KPI hooks share.

/** A month as AD date keys, first and last day. */
export type MonthRange = { start: string; end: string };
