import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Item,
  ItemUsage,
  UsageOverview,
  copyItem,
  copyText,
  createFolder,
  assignItem,
  itemUsage,
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
  refreshKey,
}: {
  onChanged: () => void;
  refreshKey: number;
}) {
  const [overview, setOverview] = useState<UsageOverview | null>(null);
  const [days, setDays] = useState<[string, number][]>([]);
  const [filter, setFilter] = useState<Filter>("frequent");
  const [items, setItems] = useState<Item[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [usage, setUsage] = useState<ItemUsage | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const timeFmt = useTimeFormat();

  const reload = useCallback(async () => {
    const [ov, dc] = await Promise.all([usageOverview(), usageDayCounts()]);
    setOverview(ov);
    setDays(dc);
    setItems(filter === "frequent" ? await listFrequent(200) : await listUnused(200));
  }, [filter]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

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

  const saveAsCollection = async () => {
    if (items.length === 0) return;
    const name = filter === "frequent" ? "Most used" : "Never used";
    const stamp = new Date().toISOString().slice(0, 10);
    const id = await createFolder(`${name} · ${stamp}`);
    await Promise.all(items.slice(0, 50).map((it) => assignItem(it.id, id)));
    toast(`Saved ${Math.min(items.length, 50)} to a collection ✓`);
    onChanged();
  };

  const copyCollection = async () => {
    const text = items
      .slice(0, 50)
      .map((it) => it.content ?? "")
      .filter(Boolean)
      .join("\n");
    if (!text) return;
    await copyText(text);
    toast("Collection copied to clipboard ✓");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
        <FlameIcon className="h-4 w-4 text-accent" /> Usage analytics
      </h2>

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
        <span className="text-xs text-fg-faint">{items.length} items</span>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={saveAsCollection}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
          >
            <FolderPlusIcon className="h-3.5 w-3.5" /> Save as collection
          </button>
          <button
            onClick={copyCollection}
            disabled={items.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
          >
            <CopyIcon className="h-3.5 w-3.5" /> Copy all
          </button>
        </div>
      </div>

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

/** A GitHub-style usage heatmap over the last ~26 weeks. */
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

  const level = (c: number): string => {
    if (c < 0) return "bg-transparent";
    if (c === 0) return "bg-bg-card";
    const r = max > 0 ? c / max : 0;
    if (r > 0.66) return "bg-accent";
    if (r > 0.33) return "bg-accent/60";
    return "bg-accent/30";
  };

  return (
    <div className="mt-4 rounded-lg border border-border bg-bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
          Usage over the last 6 months
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
      <div className="flex gap-[3px] overflow-x-auto">
        {cells.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px]">
            {col.map((cell, di) => (
              <span
                key={di}
                title={cell.iso ? `${cell.iso}: ${cell.count} use${cell.count === 1 ? "" : "s"}` : ""}
                className={`h-2.5 w-2.5 rounded-sm ${level(cell.count)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A compact "date + time" label honouring the clock-format preference. */
function fullWhen(ts: number, fmt: "24h" | "12h"): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${formatTime(ts, fmt)}`;
}
