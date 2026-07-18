import { useEffect, useRef, useState } from "react";
import { DateRange } from "../hooks/useTimeline";
import { itemDayCounts } from "../api";
import { DateNavEntry } from "../lib/dateNav";
import { Popover } from "./Popover";
import { CalendarIcon } from "./Icon";

const DAY = 86400000;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const sameDay = (a: Date, b: Date) => isoDay(a) === isoDay(b);

function dayRange(d: Date): DateRange {
  const from = startOfDay(d);
  return {
    fromMs: from,
    toMs: from + DAY,
    label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
  };
}

function Calendar(props: {
  daysWithItems: Set<string>;
  active: DateRange | null;
  onApply: (r: DateRange) => void;
  presentDays?: Set<string>;
  onNavigate?: (iso: string) => void;
}) {
  // A day already present in the current view is navigated to (smooth-scroll,
  // shared with the rail); any other day falls back to filtering the timeline.
  const pick = (date: Date) => {
    const iso = isoDay(date);
    if (props.presentDays?.has(iso) && props.onNavigate) props.onNavigate(iso);
    else props.onApply(dayRange(date));
  };
  const today = new Date();
  // Initial view: the active single day's month, else the current month.
  const initial = props.active ? new Date(props.active.fromMs) : today;
  const [view, setView] = useState({ y: initial.getFullYear(), m: initial.getMonth() });
  const [focus, setFocus] = useState<Date>(initial);
  const gridRef = useRef<HTMLDivElement>(null);

  // Keep the focused cell actually focused for keyboard users.
  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${isoDay(focus)}"]`);
    el?.focus();
  }, [focus, view]);

  const activeFrom =
    props.active && props.active.toMs - props.active.fromMs === DAY ? props.active.fromMs : null;

  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first offset
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const moveFocus = (deltaDays: number) => {
    const next = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate() + deltaDays);
    setFocus(next);
    if (next.getFullYear() !== view.y || next.getMonth() !== view.m) {
      setView({ y: next.getFullYear(), m: next.getMonth() });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-7); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(7); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (props.daysWithItems.has(isoDay(focus))) pick(focus);
    }
  };

  const goMonth = (delta: number) => setView((v) => {
    const d = new Date(v.y, v.m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const selectMonth = () => {
    const from = new Date(view.y, view.m, 1);
    const to = new Date(view.y, view.m + 1, 1);
    props.onApply({ fromMs: from.getTime(), toMs: to.getTime(), label: `${MONTHS[view.m]} ${view.y}` });
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => goMonth(-1)}
          aria-label="Previous month"
          className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          ‹
        </button>
        <button
          onClick={selectMonth}
          title="Filter the whole month"
          className="rounded px-2 py-0.5 text-sm font-medium text-fg hover:bg-bg-hover"
        >
          {MONTHS[view.m]} {view.y}
        </button>
        <button
          onClick={() => goMonth(1)}
          aria-label="Next month"
          className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pb-1 font-mono text-[10px] uppercase text-fg-faint">
            {w}
          </div>
        ))}
      </div>

      <div ref={gridRef} onKeyDown={onKeyDown} className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: lead }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const date = new Date(view.y, view.m, i + 1);
          const iso = isoDay(date);
          const has = props.daysWithItems.has(iso);
          const isToday = sameDay(date, today);
          const isSelected = activeFrom === startOfDay(date);
          const isFocus = sameDay(date, focus);
          return (
            <button
              key={iso}
              data-day={iso}
              tabIndex={isFocus ? 0 : -1}
              onClick={() => has && pick(date)}
              title={has ? "Jump to this day" : "No items"}
              className={`relative grid h-8 place-items-center rounded-md font-mono text-xs transition-colors
                ${
                  isSelected
                    ? "bg-accent text-bg"
                    : has
                    ? "cursor-pointer text-fg hover:bg-bg-hover"
                    : "cursor-default text-fg-faint/50"
                }
                ${isToday && !isSelected ? "ring-1 ring-inset ring-accent/60" : ""}
                focus:outline-none focus-visible:ring-1 focus-visible:ring-accent`}
            >
              {i + 1}
              {has && !isSelected && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateFilter(props: {
  active: DateRange | null;
  onApply: (r: DateRange) => void;
  onClear: () => void;
  presentDays?: Set<string>;
  onNavigate?: (iso: string) => void;
  /** Ordered date groups currently loaded — powers the quick-jump list that
   *  stands in for the date rail when it's hidden (narrow layouts). */
  jumpEntries?: DateNavEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<Set<string>>(new Set());
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    itemDayCounts()
      .then((pairs) => setDays(new Set(pairs.map(([d]) => d))))
      .catch(() => setDays(new Set()));
  }, [open]);

  const apply = (r: DateRange) => {
    props.onApply(r);
    setOpen(false);
  };

  const shortcuts: { label: string; make: () => DateRange }[] = [
    {
      label: "Today",
      make: () => {
        const f = startOfDay(new Date());
        return { fromMs: f, toMs: f + DAY, label: "Today" };
      },
    },
    {
      label: "Yesterday",
      make: () => {
        const t = startOfDay(new Date());
        return { fromMs: t - DAY, toMs: t, label: "Yesterday" };
      },
    },
    {
      label: "Last 7 days",
      make: () => {
        const t = startOfDay(new Date()) + DAY;
        return { fromMs: t - 7 * DAY, toMs: t, label: "Last 7 days" };
      },
    },
  ];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Filter by date"
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors lg:px-2.5 ${
          props.active
            ? "border-accent/50 bg-accent-dim text-fg"
            : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
        }`}
      >
        <CalendarIcon className="h-4 w-4" />
        <span className="hidden max-w-[9rem] truncate lg:inline">
          {props.active ? props.active.label : "Date"}
        </span>
      </button>

      <Popover anchorEl={btnRef.current} open={open} onClose={() => setOpen(false)} width={272} menu={false}>
        <div className="p-2">
          {/* Quick-jump to a loaded day — mirrors the date rail, which is hidden on
              narrow layouts. Redundant with the rail at ≥lg, so hidden there. */}
          {props.jumpEntries && props.jumpEntries.length > 0 && props.onNavigate && (
            <div className="mb-2 lg:hidden">
              <div className="mb-1 flex items-center justify-between px-0.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                  Jump to
                </span>
                <button
                  onClick={() => {
                    props.onNavigate!(props.jumpEntries![0].isoDay);
                    setOpen(false);
                  }}
                  className="rounded border border-accent/40 bg-accent-dim px-1.5 py-0.5 text-[11px] font-medium text-fg hover:border-accent/70"
                >
                  Latest
                </button>
              </div>
              <div className="max-h-32 space-y-0.5 overflow-y-auto pr-0.5">
                {props.jumpEntries.map((e) => (
                  <button
                    key={e.headerIndex}
                    onClick={() => {
                      props.onNavigate!(e.isoDay);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
                  >
                    <span className="min-w-0 flex-1 truncate">{e.compact}</span>
                    <span className="tnum shrink-0 font-mono text-[10px] text-fg-faint">{e.count}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 h-px bg-border" />
            </div>
          )}
          <div className="mb-2 flex flex-wrap gap-1">
            {shortcuts.map((s) => (
              <button
                key={s.label}
                onClick={() => apply(s.make())}
                className="rounded-md border border-border px-2 py-1 text-xs text-fg-muted hover:border-border-strong hover:text-fg"
              >
                {s.label}
              </button>
            ))}
          </div>
          <Calendar
            daysWithItems={days}
            active={props.active}
            onApply={apply}
            presentDays={props.presentDays}
            onNavigate={
              props.onNavigate
                ? (iso) => {
                    props.onNavigate!(iso);
                    setOpen(false);
                  }
                : undefined
            }
          />
          {props.active && (
            <button
              onClick={() => {
                props.onClear();
                setOpen(false);
              }}
              className="mt-2 w-full rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
            >
              Clear date filter
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}
