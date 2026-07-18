import { Row } from "./dates";

// A single navigable date group, derived from the flat virtualizer `rows`.
// `headerIndex` is the index of the group's header row in `rows`, which is what
// the virtualizer's scrollToIndex addresses.
export type DateNavEntry = {
  headerIndex: number; // index into rows[] of this date's sticky header
  label: string; // raw dayLabel: "Today" | "Yesterday" | localized full date
  compact: string; // rail label: "Today" | "Yesterday" | "Mon 14 Jul"
  monthLabel: string; // section label: "July" (adds year when not the current year)
  monthKey: string; // "2026-06" — for detecting month changes between entries
  isoDay: string; // "2026-07-14" — shared key with the calendar picker
  ts: number; // representative timestamp (first item in the group)
  count: number; // number of items in the group
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoDayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Collapse the flat header/item row list into the ordered date groups the rail
// shows (newest first, mirroring the timeline). Every header in `rows` is
// followed by at least one item, so each entry has a real timestamp.
export function buildDateNav(rows: Row[]): DateNavEntry[] {
  const nowYear = new Date().getFullYear();
  const entries: DateNavEntry[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind !== "header") continue;

    let count = 0;
    let ts = 0;
    for (let j = i + 1; j < rows.length; j++) {
      const r = rows[j];
      if (r.kind === "header") break;
      if (count === 0) ts = r.item.created_at;
      count++;
    }
    if (count === 0) continue; // defensive: skip a header with no items

    const d = new Date(ts);
    const isRelative = row.label === "Today" || row.label === "Yesterday";
    const compact = isRelative
      ? row.label
      : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const year = d.getFullYear();
    const monthLabel = year === nowYear ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${year}`;

    entries.push({
      headerIndex: i,
      label: row.label,
      compact,
      monthLabel,
      monthKey: `${year}-${pad(d.getMonth())}`,
      isoDay: isoDayOf(d),
      ts,
      count,
    });
  }

  return entries;
}

// The active entry is the one whose group owns the row currently at the top of
// the viewport: the last entry whose header sits at or above that row. Kept as a
// single source of truth so click-driven and scroll-driven highlights agree.
export function activeEntryIndex(entries: DateNavEntry[], topRowIndex: number): number {
  if (entries.length === 0) return -1;
  let active = 0;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].headerIndex <= topRowIndex) active = i;
    else break;
  }
  return active;
}
