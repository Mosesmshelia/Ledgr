// TypeScript mirror of the database's recurring-expense accrual (app_recurring_daily).
// Used for previews ("that's ₦100,000 a month") and to cross-check the SQL in tests.
import { allocate, type Kobo } from "./money";
import { addDays, daysInMonth, diffDays, type ISODate } from "./periods";

export type Frequency = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

export interface Recurring { amount: Kobo; frequency: Frequency; start_date: ISODate; end_date?: ISODate | null }

function share(total: Kobo, index1: number, n: number): Kobo {
  return allocate(total, Array.from({ length: n }, () => 1))[index1 - 1];
}

function monthIndex(d: ISODate, start: ISODate) {
  const [y, m] = d.split("-").map(Number);
  const [sy, sm] = start.split("-").map(Number);
  return y * 12 + m - (sy * 12 + sm);
}

/** Amount of a recurring expense that belongs to one calendar day. */
export function dailyAccrualOn(r: Recurring, day: ISODate): Kobo {
  if (day < r.start_date || (r.end_date && day > r.end_date)) return 0;
  const dom = Number(day.slice(8, 10));
  const dim = daysInMonth(day);
  const k = monthIndex(day, r.start_date);
  switch (r.frequency) {
    case "daily": return r.amount;
    case "weekly": return share(r.amount, (diffDays(day, r.start_date) % 7) + 1, 7);
    case "monthly": return share(r.amount, dom, dim);
    case "quarterly": return share(share(r.amount, (k % 3) + 1, 3), dom, dim);
    case "annual": return share(share(r.amount, (k % 12) + 1, 12), dom, dim);
  }
}

export function accrualBetween(r: Recurring, from: ISODate, to: ISODate): Kobo {
  let total = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) total += dailyAccrualOn(r, d);
  return total;
}

/** Simple equivalents for display ("≈ ₦100,000 a month, ≈ ₦23,077 a week"). */
export function equivalents(r: Pick<Recurring, "amount" | "frequency">) {
  const perYear = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, annual: 1 }[r.frequency];
  const yearly = r.amount * perYear;
  return { monthly: Math.round(yearly / 12), weekly: Math.round(yearly / 52), yearly };
}
