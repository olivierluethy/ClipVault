import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Item,
  ItemUsage,
  UsageOverview,
  copyItem,
  copyText,
  createFolder,
  assignItem,
  getStats,
  itemUsage,
  itemsUsedOn,
  listFrequent,
  listUnused,
  usageDayCounts,
  usageOverview,
} from "../api";
import { formatTime, useTimeFormat } from "../lib/timeFormat";
import { FlameIcon, FolderPlusIcon, CopyIcon, RepeatIcon, ClockIcon } from "./Icon";

type Filter = "frequent" | "unused";

/** Analytics dashboard: usage stats, a usage calendar, and the most-used / never-used
 *  lists with per-item history and collection actions (issue #7). */
export default function Analytics({
  onChanged,
  onNavigateHome,
  onOpenFolder,
  refreshKey,
}: {
  onChanged: () => void;
  /** Jump to the full library (all saved entries). */
  onNavigateHome: () => void;
  /** Open a specific folder/collection by id. */
  onOpenFolder: (id: string) => void;
  refreshKey: number;
}) {
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const [days, setDays] = useState<[string, number][]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>("frequent");
  const [items, setItems] = useState<Item[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [usage, setUsage] = useState<ItemUsage | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const timeFmt = useTimeFormat();

  const reload = useCallback(async () => {
    const [ov, dc, stats] = await Promise.all([usageOverview(), usageDayCounts(), getStats()]);
    setOverview(ov);
    setDays(dc);
    setSavedCount(stats.items);
    setItems(filter === "frequent" ? await listFrequent(200) : await listUnused(200));
  }, [filter]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  // The visible list changes with the filter, so a stale selection would point at rows
  // that are no longer shown — clear it whenever the filter flips.
  useEffect(() => {
    setChecked(new Set());
  }, [filter]);

  const toast = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((m) => (m === msg ? null : m)), 1800);
  };

  const reuse = async (it: Item) => {
    await copyItem(it.id);
    toast("Copied — usage recorded ✓");
    reload();
    onChanged();
  };

  const toggleDetail = async (it: Item) => {
    if (expanded === it.id) {
      setExpanded(null);
      return;
    }
    setExpanded(it.id);
    setUsage(null);
    setUsage(await itemUsage(it.id, 12));
  };

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allChecked = items.length > 0 && checked.size === items.length;
  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(items.map((it) => it.id)));
  };

  /** Rows the collection actions operate on: the checked ones, or — when nothing is
   *  checked — the whole (capped) list, preserving the original all-or-nothing default. */
  const targets = () => {
    const base = checked.size > 0 ? items.filter((it) => checked.has(it.id)) : items;
    return base.slice(0, 50);
  };

  const saveAsCollection = async () => {
    const picked = targets();
    if (picked.length === 0) return;
    const name = filter === "frequent" ? "Most used" : "Never used";
    const stamp = new Date().toISOString().slice(0, 10);
    const fullName = `${name} · ${stamp}`;
    const id = await createFolder(fullName);
    await Promise.all(picked.map((it) => assignItem(it.id, id)));
    setChecked(new Set());
    toast(`Saved ${picked.length} to “${fullName}” ✓`);
    onChanged();
    // Jump straight to the new collection so it's immediately visible.
    onOpenFolder(id);
  };

  const copyCollection = async () => {
    const text = targets()
      .map((it) => it.content ?? "")
      .filter(Boolean)
      .join("\n");
    if (!text) return;
    await copyText(text);
    toast("Collection copied to clipboard ✓");
  };

  const selectionCount = checked.size;
  const saveLabel = selectionCount > 0 ? `Save ${selectionCount} as collection` : "Save as collection";
  const copyLabel = selectionCount > 0 ? `Copy ${selectionCount}` : "Copy all";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
        <FlameIcon className="h-4 w-4 text-accent" /> Usage analytics
      </h2>

      {/* Headline: total saved entries — a plain number that jumps to the full library. */}
      <button
        onClick={onNavigateHome}
        title="Show all saved entries"
        className="group mb-3 flex w-full items-baseline gap-2 rounded-lg border border-border bg-bg-card/50 px-4 py-3 text-left transition-colors hover:border-accent hover:bg-bg-hover/40"
      >
        <span className="font-mono text-2xl tnum text-fg">
          {savedCount === null ? "—" : savedCount.toLocaleString()}
        </span>
        <span className="text-sm text-fg-muted">saved entries</span>
        <span className="ml-auto text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent">
          →
        </span>
      </button>

      {/* Overview stat tiles. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total uses" value={overview?.total_uses ?? 0} />
        <Stat label="Items used" value={overview?.used_items ?? 0} />
        <Stat label="Never used" value={overview?.unused_items ?? 0} />
        <Stat label="Active days" value={overview?.active_days ?? 0} />
        <Stat
          label="Busiest day"
          value={overview?.busiest_day ? overview.busiest_day[1] : 0}
          hint={overview?.busiest_day?.[0]}
        />
      </div>

      {/* Usage calendar (heatmap). */}
      <Heatmap days={days} />

      {/* Filter + collection actions. */}
      <div className="mb-2 mt-4 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border">
          {(["frequent", "unused"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 text-xs transition-colors ${
                filter === f ? "bg-accent-dim text-fg" : "text-fg-muted hover:bg-bg-hover"
              }`}
            >
              {f === "frequent" ? "Most used" : "Never used"}
            </button>
          ))}
        </div>
        <span className="text-xs text-fg-faint">
          {items.length} items{selectionCount > 0 ? ` · ${selectionCount} selected` : ""}
        </span>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={saveAsCollection}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
          >
            <FolderPlusIcon className="h-3.5 w-3.5" /> {saveLabel}
          </button>
          <button
            onClick={copyCollection}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
          >
            <CopyIcon className="h-3.5 w-3.5" /> {copyLabel}
          </button>
        </div>
      </div>

      {/* Select-all row. */}
      {items.length > 0 && (
        <label className="mb-1 flex w-fit cursor-pointer items-center gap-2 px-2 text-[11px] text-fg-faint hover:text-fg-muted">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            className="h-3.5 w-3.5 accent-accent"
          />
          {allChecked ? "Deselect all" : "Select all"}
        </label>
      )}

      {/* Item list. */}
      <div className="space-y-1">
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-fg-muted">
            {filter === "frequent"
              ? "Nothing reused yet — reuse an item and it'll rank here."
              : "Everything has been used at least once. 🎉"}
          </p>
        )}
        {items.map((it) => (
          <div key={it.id} className="rounded-md border border-transparent hover:border-border hover:bg-bg-hover/30">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <input
                type="checkbox"
                checked={checked.has(it.id)}
                onChange={() => toggleCheck(it.id)}
                title="Select for a collection"
                className="h-3.5 w-3.5 shrink-0 accent-accent"
              />
              <button
                onClick={() => reuse(it)}
                title="Copy (records a use)"
                className="min-w-0 flex-1 truncate text-left font-mono text-sm text-fg/90"
              >
                {it.content ?? it.item_type}
              </button>
              {it.reuse_count > 0 && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-bg-hover/70 px-2 py-0.5 font-mono text-[10px] text-fg-muted">
                  <RepeatIcon className="h-3 w-3 text-fg-faint" />
                  {it.reuse_count}×
                </span>
              )}
              <button
                onClick={() => toggleDetail(it)}
                className="shrink-0 rounded px-2 py-0.5 text-[11px] text-fg-faint hover:bg-bg-hover hover:text-fg-muted"
              >
                {expanded === it.id ? "Hide" : "History"}
              </button>
            </div>
            {expanded === it.id && (
              <div className="border-t border-border px-3 py-2 text-xs text-fg-muted">
                {!usage ? (
                  <span className="text-fg-faint">Loading…</span>
                ) : usage.count === 0 ? (
                  <span className="text-fg-faint">No recorded uses yet.</span>
                ) : (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>Used <span className="text-fg">{usage.count}×</span></span>
                      {usage.last_used && (
                        <span className="inline-flex items-center gap-1">
                          <ClockIcon className="h-3 w-3" /> Last:{" "}
                          <span className="text-fg">{fullWhen(usage.last_used, timeFmt)}</span>
                        </span>
                      )}
                      {usage.first_used && (
                        <span>First: <span className="text-fg">{fullWhen(usage.first_used, timeFmt)}</span></span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {usage.recent.map((ts, i) => (
                        <span key={i} className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px] text-fg-faint">
                          {fullWhen(ts, timeFmt)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {flash && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-bg-raised px-4 py-2 text-sm text-fg shadow-lg">
          {flash}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card/50 px-3 py-2">
      <div className="font-mono text-lg tnum text-fg">{value}</div>
      <div className="text-[11px] text-fg-muted">{label}</div>
      {hint && <div className="truncate text-[10px] text-fg-faint">{hint}</div>}
    </div>
  );
}

/** A GitHub-style usage heatmap over the last ~26 weeks, with month/year labels, a
 *  styled hover tooltip, and a click-to-inspect per-day detail panel. */
function Heatmap({ days }: { days: [string, number][] }) {
  const counts = useMemo(() => new Map(days), [days]);
  const max = useMemo(() => days.reduce((m, [, c]) => Math.max(m, c), 0), [days]);

  const weeks = 26;
  const cells = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - (weeks - 1) * 7);
    const cols: { iso: string; count: number }[][] = [];
    for (let w = 0; w < weeks; w++) {
      const col: { iso: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        if (date > today) {
          col.push({ iso: "", count: -1 });
          continue;
        }
        const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        col.push({ iso, count: counts.get(iso) ?? 0 });
      }
      cols.push(col);
    }
    return cols;
  }, [counts]);

  // Month label above a column when its top cell opens a new month (blank otherwise),
  // GitHub-style: the label overflows to the right over the following blank slots.
  const monthLabels = useMemo(
    () =>
      cells.map((col, ci) => {
        const iso = col[0].iso;
        if (!iso) return "";
        const m = iso.slice(0, 7);
        const prev = ci > 0 ? cells[ci - 1][0].iso.slice(0, 7) : "";
        return m !== prev ? MONTHS[Number(iso.slice(5, 7)) - 1] : "";
      }),
    [cells]
  );

  const yearLabel = useMemo(() => {
    const firstIso = cells[0]?.[0].iso;
    if (!firstIso) return "";
    const y1 = firstIso.slice(0, 4);
    const y2 = String(new Date().getFullYear());
    return y1 === y2 ? y1 : `${y1} – ${y2}`;
  }, [cells]);

  const level = (c: number): string => {
    if (c < 0) return "bg-transparent";
    if (c === 0) return "bg-bg-card";
    const r = max > 0 ? c / max : 0;
    if (r > 0.66) return "bg-accent";
    if (r > 0.33) return "bg-accent/60";
    return "bg-accent/30";
  };

  // Hover tooltip: which cell, and where the cursor is (relative to the wrapper, which
  // does not scroll — so the tooltip is never clipped by the grid's horizontal scroll).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ iso: string; count: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Click-to-inspect: the selected day and the entries used on it.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayItems, setDayItems] = useState<Item[] | null>(null);

  const selectDay = async (iso: string) => {
    if (!iso) return;
    if (selectedDay === iso) {
      setSelectedDay(null);
      setDayItems(null);
      return;
    }
    setSelectedDay(iso);
    setDayItems(null);
    setDayItems(await itemsUsedOn(iso, 50));
  };

  const selectedCount = selectedDay ? counts.get(selectedDay) ?? 0 : 0;

  return (
    <div className="mt-4 rounded-lg border border-border bg-bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
            Usage over the last 6 months
          </span>
          {yearLabel && <span className="font-mono text-[10px] text-fg-muted">{yearLabel}</span>}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-fg-faint">
          less
          <span className="h-2.5 w-2.5 rounded-sm bg-bg-card" />
          <span className="h-2.5 w-2.5 rounded-sm bg-accent/30" />
          <span className="h-2.5 w-2.5 rounded-sm bg-accent/60" />
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
          more
        </span>
      </div>

      <div ref={wrapRef} className="relative">
        <div className="overflow-x-auto" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {/* Month labels, aligned to and as wide as the day columns. */}
          <div className="mb-1 flex gap-[3px]">
            {monthLabels.map((label, ci) => (
              <div
                key={ci}
                className="w-2.5 whitespace-nowrap text-[9px] leading-none text-fg-faint"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {cells.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((cell, di) => (
                  <button
                    key={di}
                    type="button"
                    disabled={!cell.iso}
                    onMouseEnter={() => cell.iso && setHover({ iso: cell.iso, count: cell.count })}
                    onClick={() => selectDay(cell.iso)}
                    className={`h-2.5 w-2.5 rounded-sm ${level(cell.count)} ${
                      cell.iso ? "cursor-pointer" : "cursor-default"
                    } ${selectedDay && cell.iso === selectedDay ? "ring-1 ring-accent" : ""}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-bg-raised px-2 py-1 text-[11px] text-fg shadow-lg"
            style={{ left: pos.x, top: pos.y - 6 }}
          >
            {dayLabel(hover.iso)} — {usesText(hover.count)}
          </div>
        )}
      </div>

      {/* Per-day detail panel. */}
      {selectedDay && (
        <div className="mt-3 rounded-md border border-border bg-bg-card/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-fg">
              {dayLabel(selectedDay)} <span className="text-fg-muted">— {usesText(selectedCount)}</span>
            </span>
            <button
              onClick={() => {
                setSelectedDay(null);
                setDayItems(null);
              }}
              className="rounded px-1.5 text-fg-faint hover:bg-bg-hover hover:text-fg"
              title="Close"
            >
              ✕
            </button>
          </div>
          {dayItems === null ? (
            <span className="text-xs text-fg-faint">Loading…</span>
          ) : dayItems.length === 0 ? (
            <span className="text-xs text-fg-faint">No entries for this day.</span>
          ) : (
            <div className="space-y-1">
              {dayItems.map((it) => (
                <div
                  key={it.id}
                  className="truncate rounded bg-bg-card px-2 py-1 font-mono text-xs text-fg-muted"
                  title={it.content ?? it.item_type}
                >
                  {it.content ?? it.item_type}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Localised short month names ("Jan", "Feb", … / "Jän", "Feb", …), index 0 = January. */
const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString(undefined, { month: "short" })
);

/** A cleanly formatted, locale-aware label for a local calendar day ("YYYY-MM-DD"). */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "no uses" / "1 use" / "N uses". */
function usesText(n: number): string {
  if (n <= 0) return "no uses";
  return `${n} use${n === 1 ? "" : "s"}`;
}

/** A compact "date + time" label honouring the clock-format preference. */
function fullWhen(ts: number, fmt: "24h" | "12h"): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${formatTime(ts, fmt)}`;
}
