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
