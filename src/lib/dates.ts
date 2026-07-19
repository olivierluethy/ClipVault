export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

// Flatten items into a header/item row list for the virtualizer.
export type Row =
  | { kind: "header"; label: string }
  | { kind: "item"; item: import("../api").Item };

/** Bare registrable-ish domain of a URL (drops a leading www.). "other" if unparsable. */
export function domainOf(url: string): string {
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, "") || "other";
  } catch {
    return "other";
  }
}

/** Group link items under domain headers ("github.com (12)"), domains ordered by
 *  count (desc) then name. Items keep their incoming (newest-first) order. */
export function toDomainRows(items: import("../api").Item[]): Row[] {
  const groups = new Map<string, import("../api").Item[]>();
  for (const it of items) {
    const d = it.content ? domainOf(it.content) : "other";
    const arr = groups.get(d);
    if (arr) arr.push(it);
    else groups.set(d, [it]);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
  );
  const rows: Row[] = [];
  for (const [domain, its] of ordered) {
    rows.push({ kind: "header", label: `${domain} (${its.length})` });
    for (const it of its) rows.push({ kind: "item", item: it });
  }
  return rows;
}

export function toRows(items: import("../api").Item[]): Row[] {
  const rows: Row[] = [];
  let last = "";
  for (const it of items) {
    const label = dayLabel(it.created_at);
    if (label !== last) {
      rows.push({ kind: "header", label });
      last = label;
    }
    rows.push({ kind: "item", item: it });
  }
  return rows;
}
