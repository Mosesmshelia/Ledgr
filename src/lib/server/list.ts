import "server-only";
// Shared, URL-driven list handling: search, date range, filters, sort and paging.
// Everything is in the URL, so a filtered list can be bookmarked, shared or refreshed,
// and it works before any JavaScript loads. Sort keys are whitelisted — never raw SQL from the URL.

export const LIST_PAGE_SIZE = 30;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type ListParams = { q?: string; from?: string; to?: string; sort?: string; dir?: "asc" | "desc"; page: number } & Record<string, string | number | undefined>;

export function readListParams(sp: Record<string, string | undefined>, defaults: { sort: string; dir?: "asc" | "desc" }): ListParams {
  const page = Math.max(1, Math.min(10_000, Number(sp.page) || 1));
  return {
    ...sp,
    q: sp.q?.trim().slice(0, 100) || undefined,
    from: sp.from && ISO.test(sp.from) ? sp.from : undefined,
    to: sp.to && ISO.test(sp.to) ? sp.to : undefined,
    sort: sp.sort || defaults.sort,
    dir: sp.dir === "asc" || sp.dir === "desc" ? sp.dir : defaults.dir ?? "desc",
    page,
  };
}

/** Collects WHERE clauses and parameters safely ($1, $2 …). */
export class Where {
  parts: string[] = [];
  params: unknown[] = [];
  constructor(first: string, ...params: unknown[]) { this.add(first, ...params); }
  /** Add a clause; use ? for each parameter. */
  add(clause: string, ...params: unknown[]) {
    let i = 0;
    this.parts.push(clause.replace(/\?/g, () => `$${this.params.length + ++i}`));
    this.params.push(...params);
    return this;
  }
  get sql() { return this.parts.join(" and "); }
}

/** ORDER BY + LIMIT/OFFSET from whitelisted sort keys. Fetches one extra row to know if there's a next page. */
export function orderAndPage(p: ListParams, sorts: Record<string, string>, fallback: string, w: Where, tiebreak = "created_at desc") {
  const col = sorts[p.sort ?? ""] ?? sorts[fallback];
  const dir = p.dir === "asc" ? "asc" : "desc";
  const lim = w.params.length + 1;
  w.params.push(LIST_PAGE_SIZE + 1, (p.page - 1) * LIST_PAGE_SIZE);
  return `order by ${col} ${dir} nulls last, ${tiebreak} limit $${lim} offset $${lim + 1}`;
}

export function pageOf<T>(rows: T[], p: ListParams) {
  return { rows: rows.slice(0, LIST_PAGE_SIZE), hasMore: rows.length > LIST_PAGE_SIZE, page: p.page, pageSize: LIST_PAGE_SIZE };
}

/** Escape % and _ so a search for "50%" matches literally. */
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
