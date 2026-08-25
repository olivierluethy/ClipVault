import { Fragment, useEffect, useMemo, useRef } from "react";
import { DateNavEntry, activeEntryIndex } from "../lib/dateNav";
import { ChevronLeftIcon, ChevronRightIcon, TimelineIcon } from "./Icon";

const RAIL_MIN = 128;
const RAIL_MAX = 320;

// A quiet chronological axis docked to the right of the timeline: a hairline
// spine with a node per date. The node of the date currently in view glows in
// the accent and travels as you scroll (scroll-spy); clicking any node jumps
// the timeline to that date. `topRowIndex` is the virtualizer row at the top of
// the viewport — the single input that keeps the highlight in sync with scroll.
// The panel can be collapsed to a thin strip and drag-resized (issue #4).
export function DateRail(props: {
  entries: DateNavEntry[];
  topRowIndex: number;
  onJump: (headerIndex: number) => void;
  collapsed?: boolean;
  width?: number;
  onToggleCollapsed?: () => void;
  onResize?: (width: number) => void;
}) {
  const { entries, topRowIndex, onJump, collapsed = false, width = 152 } = props;

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

  // Drag the panel's LEFT edge to resize (it's docked right, so leftward = wider).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(RAIL_MIN, Math.min(RAIL_MAX, startW + (startX - ev.clientX)));
      props.onResize?.(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (entries.length === 0) return null;

  // Collapsed: a thin strip with an expand control, so the History panel can be
  // hidden without giving up the way back to it.
  if (collapsed) {
    return (
      <aside
        aria-label="History (collapsed)"
        className="hidden w-9 shrink-0 flex-col items-center gap-2 border-l border-border bg-bg py-2 lg:flex"
      >
        <button
          onClick={props.onToggleCollapsed}
          title="Show History panel"
          aria-label="Show History panel"
          className="grid h-7 w-7 place-items-center rounded-md text-fg-muted hover:bg-bg-raised hover:text-fg"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <TimelineIcon className="h-4 w-4 text-fg-faint" />
      </aside>
    );
  }

  return (
    <>
      {/* Left-edge resize handle (flex sibling, pinned regardless of rail scroll). */}
      {props.onResize && (
        <div
          onPointerDown={startResize}
          title="Drag to resize"
          role="separator"
          aria-orientation="vertical"
          className="group/resize relative z-30 -mr-1 hidden w-2 shrink-0 cursor-col-resize lg:block"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/resize:bg-accent/50" />
        </div>
      )}
      <aside
        aria-label="Jump to date"
        style={{ width }}
        className="hidden shrink-0 flex-col border-l border-border bg-bg lg:flex"
      >
        {/* Header: title + collapse toggle. */}
        <div className="flex items-center justify-between px-2.5 pb-0.5 pt-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
            History
          </span>
          {props.onToggleCollapsed && (
            <button
              onClick={props.onToggleCollapsed}
              title="Hide History panel"
              aria-label="Hide History panel"
              className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-bg-raised hover:text-fg"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          )}
        </div>
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
    </>
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
