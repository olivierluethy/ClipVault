import { useEffect, useRef, useState } from "react";
import { DateRange } from "../hooks/useTimeline";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function dayStr(d: Date): string {
  // yyyy-mm-dd in local time (for <input type="date">).
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseDayStart(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function parseDayEndExclusive(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
}

type Preset = { label: string; make: () => DateRange };

const PRESETS: Preset[] = [
  {
    label: "Today",
    make: () => {
      const from = startOfDay(new Date()).getTime();
      return { fromMs: from, toMs: from + 86400000, label: "Today" };
    },
  },
  {
    label: "Yesterday",
    make: () => {
      const to = startOfDay(new Date()).getTime();
      return { fromMs: to - 86400000, toMs: to, label: "Yesterday" };
    },
  },
  {
    label: "Last 7 days",
    make: () => {
      const to = startOfDay(new Date()).getTime() + 86400000;
      return { fromMs: to - 7 * 86400000, toMs: to, label: "Last 7 days" };
    },
  },
  {
    label: "This month",
    make: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { fromMs: from, toMs: to, label: "This month" };
    },
  },
  {
    label: "Last month",
    make: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const to = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const label = new Date(from).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      return { fromMs: from, toMs: to, label };
    },
  },
];

export function DateFilter(props: {
  active: DateRange | null;
  onApply: (r: DateRange) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const applyCustom = () => {
    if (!from && !to) return;
    // Missing edge = open-ended (very wide bound on that side).
    const fromMs = from ? parseDayStart(from) : 0;
    const toMs = to ? parseDayEndExclusive(to) : Date.now() + 86400000;
    const fmt = (s: string) => new Date(parseDayStart(s)).toLocaleDateString();
    const label =
      from && to ? `${fmt(from)} – ${fmt(to)}` : from ? `From ${fmt(from)}` : `Until ${fmt(to)}`;
    props.onApply({ fromMs, toMs, label });
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={panelRef}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open && props.active) {
            // Prefill custom inputs from an active range for easy tweaking.
            setFrom(dayStr(new Date(props.active.fromMs)));
            setTo(dayStr(new Date(props.active.toMs - 1)));
          }
        }}
        title="Filter by date"
        className={`px-2 py-1 rounded border text-sm ${
          props.active ? "border-accent bg-accent-dim/40 text-fg" : "border-border text-fg-muted hover:text-fg hover:border-accent"
        }`}
      >
        📅 {props.active ? props.active.label : "Date"}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border border-border bg-bg-raised p-3 shadow-2xl space-y-3">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  props.onApply(p.make());
                  setOpen(false);
                }}
                className="rounded border border-border px-2 py-1 text-xs text-fg-muted hover:text-fg hover:border-accent"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-border pt-2">
            <div className="text-xs uppercase tracking-wide text-fg-muted">Custom range</div>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-fg-muted">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span className="text-fg-muted">To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:border-accent"
              />
            </label>
            <button
              onClick={applyCustom}
              className="w-full rounded border border-accent bg-accent-dim/40 px-3 py-1 text-sm text-fg hover:bg-accent-dim"
            >
              Apply range
            </button>
          </div>

          {props.active && (
            <button
              onClick={() => {
                props.onClear();
                setOpen(false);
              }}
              className="w-full rounded border border-border px-3 py-1 text-sm text-fg-muted hover:text-fg"
            >
              Clear date filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
