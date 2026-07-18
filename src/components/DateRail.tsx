import { Fragment, useEffect, useMemo, useRef } from "react";
import { DateNavEntry, activeEntryIndex } from "../lib/dateNav";

// A quiet chronological axis docked to the right of the timeline: a hairline
// spine with a node per date. The node of the date currently in view glows in
// the accent and travels as you scroll (scroll-spy); clicking any node jumps
// the timeline to that date. `topRowIndex` is the virtualizer row at the top of
// the viewport — the single input that keeps the highlight in sync with scroll.
export function DateRail(props: {
  entries: DateNavEntry[];
  topRowIndex: number;
  onJump: (headerIndex: number) => void;
}) {
  const { entries, topRowIndex, onJump } = props;

  const activeIdx = useMemo(
    () => activeEntryIndex(entries, topRowIndex),
    [entries, topRowIndex],
  );
  const active = entries[activeIdx];
  const atLatest = activeIdx <= 0;

  // Keep the active node visible when the rail is scrollable (long histories).
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active?.headerIndex]);

  if (entries.length === 0) return null;

  return (
    <aside
      aria-label="Jump to date"
      className="hidden w-[152px] shrink-0 flex-col border-l border-border bg-bg lg:flex"
    >
      {/* Pinned return-to-newest control. */}
      <button
        onClick={() => onJump(entries[0].headerIndex)}
        title="Jump to the latest items"
        className={`group m-2 mb-1 flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
          atLatest
            ? "border-accent/40 bg-accent-dim text-fg"
            : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
        }`}
      >
        <ArrowUp
          className={`h-3.5 w-3.5 shrink-0 transition-colors ${
            atLatest ? "text-accent" : "text-fg-faint group-hover:text-fg-muted"
          }`}
        />
        <span className="text-[13px] font-medium leading-none">Latest</span>
      </button>

      {/* Scrollable axis of dates. */}
      <nav className="relative min-h-0 flex-1 overflow-y-auto py-1">
        {/* The spine: a hairline that reads as the chronological axis. */}
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-[19px] top-3 w-px bg-border"
        />
        {entries.map((e, i) => {
          const showMonth = i === 0 || e.monthKey !== entries[i - 1].monthKey;
          const isActive = i === activeIdx;
          return (
            <Fragment key={e.headerIndex}>
              {showMonth && (
                <div className="px-3 pb-1 pl-[34px] pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint first:pt-1">
                  {e.monthLabel}
                </div>
              )}
              <button
                ref={isActive ? activeRef : undefined}
                onClick={() => onJump(e.headerIndex)}
                aria-current={isActive ? "true" : undefined}
                title={`${e.label} — ${e.count} item${e.count === 1 ? "" : "s"}`}
                className={`group relative flex w-full items-center gap-2 py-[5px] pl-[34px] pr-3 text-left transition-colors ${
                  isActive ? "text-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                {/* Active pill sits behind the label, easing in with the accent. */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-y-[2px] left-[26px] right-1.5 rounded-md transition-colors ${
                    isActive ? "bg-accent-dim" : "bg-transparent group-hover:bg-bg-hover/50"
                  }`}
                />
                {/* Node on the spine. */}
                <span
                  aria-hidden
                  className={`absolute left-[19px] top-1/2 z-[1] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-200 ${
                    isActive
                      ? "border-accent bg-accent shadow-[0_0_0_3px_rgba(123,97,255,0.18)]"
                      : "border-border-strong bg-bg group-hover:border-accent/60"
                  }`}
                />
                <span
                  className={`relative z-[1] min-w-0 flex-1 truncate text-[13px] leading-tight ${
                    isActive ? "font-medium text-accent" : ""
                  }`}
                >
                  {e.compact}
                </span>
                <span
                  className={`tnum relative z-[1] shrink-0 font-mono text-[10px] leading-none transition-colors ${
                    isActive ? "text-accent/80" : "text-fg-faint"
                  }`}
                >
                  {e.count}
                </span>
              </button>
            </Fragment>
          );
        })}
      </nav>
    </aside>
  );
}

function ArrowUp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M8 13V3.5M8 3.5 4 7.5M8 3.5 12 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
