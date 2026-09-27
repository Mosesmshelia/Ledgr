// Money is always an integer number of kobo (₦1 = 100 kobo). Never floats.
export type Kobo = number;

export const KOBO_PER_NAIRA = 100;

export function assertKobo(n: number): asserts n is Kobo {
  if (!Number.isSafeInteger(n)) throw new Error(`Not a whole kobo amount: ${n}`);
}

/** ₦ amount (as typed by a person) → kobo. "1,200.50" → 120050. Returns null if not a valid amount. */
export function parseNaira(input: string | number | null | undefined): Kobo | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₦,\s]/g, "").trim();
  if (s === "" || !/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const k = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return s.startsWith("-") ? -k : k;
}

export function toNaira(k: Kobo): number {
  return k / 100;
}

/**
 * Split `total` across weights so the parts add up EXACTLY to total (cumulative-floor method).
 * part_i = floor(total·cw_i / W) − floor(total·cw_{i−1} / W). Uses BigInt, so no rounding drift.
 */
export function allocate(total: Kobo, weights: number[]): Kobo[] {
  assertKobo(total);
  // weights may carry up to 3 decimals (quantities)
  const w = weights.map((x) => BigInt(Math.round(x * 1000)));
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0);
  const T = BigInt(total);
  const floorDiv = (a: bigint, b: bigint) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
  let cum = 0n;
  let prev = 0n;
  return w.map((wi) => {
    cum += wi;
    const upto = floorDiv(T * cum, sum);
    const part = upto - prev;
    prev = upto;
    return Number(part);
  });
}

/** Spread `total` evenly over n parts (e.g. days), exact to the kobo. */
export function spread(total: Kobo, n: number): Kobo[] {
  return allocate(total, Array.from({ length: n }, () => 1));
}

/** Multiply kobo by a ratio and round half away from zero to whole kobo. */
export function mulRound(k: Kobo, numerator: number, denominator = 1): Kobo {
  const v = (k * numerator) / denominator;
  return Math.sign(v) * Math.round(Math.abs(v));
}

const full = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const full2 = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface MoneyFormat {
  /** ₦4.85m / ₦620k — for cards. */
  compact?: boolean;
  /** Always show kobo (reports, invoices). Default: rounded to whole naira. */
  exact?: boolean;
  /** Prefix + for positive values (changes, variances). */
  signed?: boolean;
}

export function formatMoney(k: Kobo | null | undefined, opts: MoneyFormat = {}): string {
  if (k === null || k === undefined || Number.isNaN(k)) return "—";
  const neg = k < 0;
  const abs = Math.abs(k);
  const sign = neg ? "−" : opts.signed && k > 0 ? "+" : "";
  if (opts.compact) {
    const n = abs / 100;
    let body: string;
    if (n >= 1_000_000_000) body = trim(n / 1_000_000_000, n >= 10_000_000_000 ? 1 : 2) + "bn";
    else if (n >= 1_000_000) body = trim(n / 1_000_000, n >= 10_000_000 ? 1 : 2) + "m";
    else if (n >= 1_000) body = trim(n / 1_000, n >= 100_000 ? 0 : 1) + "k";
    else body = full.format(Math.round(n));
    return `${sign}₦${body}`;
  }
  // Default: whole naira (calm to read). `exact` shows kobo — reports, invoices, "how it was calculated".
  const body = opts.exact ? full2.format(abs / 100) : full.format(Math.round(abs / 100));
  return `${sign}₦${body}`;
}

function trim(n: number, dp: number): string {
  // floor-ish display that never rounds up past the real value by more than display precision
  const f = Math.pow(10, dp);
  const v = Math.round(n * f) / f;
  const t = v.toFixed(dp);
  return t.includes(".") ? t.replace(/\.?0+$/, "") : t;
}

/** Ratio (0.3429) → "34.3%". null → "—". */
export function formatPercent(ratio: number | null | undefined, dp = 1, signed = false): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const v = ratio * 100;
  const s = Math.abs(v).toFixed(dp);
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return `${sign}${s}%`;
}

export function formatQty(q: number, unit?: string): string {
  const s = Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return unit && unit !== "unit" ? `${s} ${unit}` : s;
}
