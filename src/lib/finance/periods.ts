// Period maths on business-local calendar dates ('YYYY-MM-DD'). No JS Date timezone surprises:
// dates are handled as UTC-midnight values purely for arithmetic.

export type ISODate = string;

export type PeriodKey =
  | "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month"
  | "this_quarter" | "this_year" | "custom";

export interface Period {
  key: PeriodKey;
  from: ISODate;
  to: ISODate;
  label: string;
}

const DAY = 86_400_000;

export function toUTC(d: ISODate): number {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
}
export function fromUTC(t: number): ISODate {
  return new Date(t).toISOString().slice(0, 10);
}
export function addDays(d: ISODate, n: number): ISODate {
  return fromUTC(toUTC(d) + n * DAY);
}
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a) - toUTC(b)) / DAY);
}
export function daysInclusive(from: ISODate, to: ISODate): number {
  return diffDays(to, from) + 1;
}
export function daysInMonth(d: ISODate): number {
  const [y, m] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function startOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + "01";
}
export function endOfMonth(d: ISODate): ISODate {
  return d.slice(0, 8) + String(daysInMonth(d)).padStart(2, "0");
}
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, dd] = d.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(dd, dim));
  return fromUTC(first.getTime());
}
/** 0 = Sunday … 6 = Saturday */
export function weekday(d: ISODate): number {
  return new Date(toUTC(d)).getUTCDay();
}
export function startOfWeek(d: ISODate, weekStart = 1): ISODate {
  const back = (weekday(d) - weekStart + 7) % 7;
  return addDays(d, -back);
}

/** Today's date in the business timezone (default Africa/Lagos). */
export function todayIn(timeZone = "Africa/Lagos", now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(d: ISODate, withYear = false): string {
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MONTHS[m - 1]}${withYear ? " " + y : ""}`;
}
export function formatRange(from: ISODate, to: ISODate): string {
  if (from === to) return formatDate(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDate(from, !sameYear)} – ${formatDate(to, true)}`;
}

/** Resolve a named period. "This week/month/quarter/year" run from their start up to today (to-date). */
export function resolvePeriod(key: PeriodKey, today: ISODate, weekStart = 1, custom?: { from: ISODate; to: ISODate }): Period {
  switch (key) {
    case "today": return { key, from: today, to: today, label: "Today" };
    case "yesterday": { const y = addDays(today, -1); return { key, from: y, to: y, label: "Yesterday" }; }
    case "this_week": return { key, from: startOfWeek(today, weekStart), to: today, label: "This week" };
    case "last_week": {
      const s = addDays(startOfWeek(today, weekStart), -7);
      return { key, from: s, to: addDays(s, 6), label: "Last week" };
    }
    case "this_month": return { key, from: startOfMonth(today), to: today, label: "This month" };
    case "last_month": {
      const s = startOfMonth(addMonths(startOfMonth(today), -1));
      return { key, from: s, to: endOfMonth(s), label: "Last month" };
    }
    case "this_quarter": {
      const [y, m] = today.split("-").map(Number);
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { key, from: `${y}-${String(qm).padStart(2, "0")}-01`, to: today, label: "This quarter" };
    }
    case "this_year": return { key, from: today.slice(0, 4) + "-01-01", to: today, label: "This year" };
    case "custom": {
      if (!custom) throw new Error("custom period needs from/to");
      const [from, to] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
      return { key, from, to, label: formatRange(from, to) };
    }
  }
}

/**
 * The like-for-like previous period (Rule 13):
 *  - this week so far (Mon–Wed) → last week Mon–Wed
 *  - this month so far (1st–17th) → last month 1st–17th (capped at month end)
 *  - full weeks/months → the previous full week/month
 *  - anything else → the same number of days immediately before
 */
export function previousComparable(p: Period): Period {
  const len = daysInclusive(p.from, p.to);
  switch (p.key) {
    case "today":
    case "yesterday":
      return { key: "custom", from: addDays(p.from, -1), to: addDays(p.to, -1), label: p.key === "today" ? "yesterday" : "the day before" };
    case "this_week":
    case "last_week":
      return { key: "custom", from: addDays(p.from, -7), to: addDays(p.to, -7), label: "last week" };
    case "this_month":
    case "last_month": {
      const from = startOfMonth(addMonths(p.from, -1));
      const full = p.key === "last_month";
      const to = full ? endOfMonth(from) : fromUTC(Math.min(toUTC(addDays(from, len - 1)), toUTC(endOfMonth(from))));
      return { key: "custom", from, to, label: "last month" };
    }
    case "this_quarter": {
      const from = addMonths(p.from, -3);
      const to = fromUTC(Math.min(toUTC(addDays(from, len - 1)), toUTC(addDays(p.from, -1))));
      return { key: "custom", from, to, label: "last quarter" };
    }
    case "this_year": {
      const from = addMonths(p.from, -12);
      return { key: "custom", from, to: addMonths(p.to, -12), label: "last year" };
    }
    default:
      return { key: "custom", from: addDays(p.from, -len), to: addDays(p.from, -1), label: "previous period" };
  }
}

/** Break a range into consecutive buckets for charts. */
export function buckets(from: ISODate, to: ISODate, size: "day" | "week" | "month", weekStart = 1): { from: ISODate; to: ISODate; label: string }[] {
  const out: { from: ISODate; to: ISODate; label: string }[] = [];
  let cur = size === "week" ? startOfWeek(from, weekStart) : size === "month" ? startOfMonth(from) : from;
  while (cur <= to) {
    const end = size === "day" ? cur : size === "week" ? addDays(cur, 6) : endOfMonth(cur);
    const f = cur < from ? from : cur;
    const t = end > to ? to : end;
    out.push({ from: f, to: t, label: size === "month" ? MONTHS[Number(cur.slice(5, 7)) - 1] : formatDate(f) });
    cur = addDays(end, 1);
  }
  return out;
}
