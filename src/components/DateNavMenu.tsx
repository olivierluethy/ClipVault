import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DateNavEntry, activeEntryIndex } from "../lib/dateNav";
import { Popover } from "./Popover";
import { TimelineIcon } from "./Icon";

// The date rail, distilled for narrow layouts where the rail itself is hidden.
// It is the SAME feature in a compact form, not a second copy: it consumes the
// same `entries`, the same scroll-spy input (`topRowIndex` → `activeEntryIndex`),
// and the same jump callback (`onJump`) the wide rail uses. Only rendered below
// `lg`; the rail takes over at ≥lg, so date navigation is continuous across
// every width. The popover carries the rail's spine-and-node signature so the
// two presentations read as one.
export function DateNavMenu(props: {
  entries: DateNavEntry[];
  topRowIndex: number;
  onJump: (headerIndex: number) => void;
}) {
  const { entries, topRowIndex, onJump } = props;
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const activeIdx = useMemo(
    () => activeEntryIndex(entries, topRowIndex),
    [entries, topRowIndex],
  );
  const atLatest = activeIdx <= 0;

  // Bring the active day into view when the popover opens, so the current
  // position is visible even in a long history.
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(
      () => activeRef.current?.scrollIntoView({ block: "center" }),
      0,
    );
    return () => window.clearTimeout(id);
  }, [open]);

  if (entries.length === 0) return null;

  const jump = (headerIndex: number) => {
    onJump(headerIndex);
    setOpen(false);
  };

  return (
    <div className="shrink-0 lg:hidden">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Jump between days"
        aria-label="Jump between days"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`grid h-8 w-8 place-items-center rounded-md border transition-colors ${
          open
            ? "border-accent/50 bg-accent-dim text-fg"
            : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
        }`}
      >
        <TimelineIcon className="h-4 w-4" />
      </button>

      <Popover
        anchorEl={btnRef.current}
        open={open}
        onClose={() => setOpen(false)}
        width={264}
        menu={false}
      >
        <div className="flex max-h-[min(70vh,26rem)] flex-col p-1">
          <div className="px-1.5 pb-1 pt-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              Jump to day
            </span>
          </div>

          {/* Pinned return-to-newest — mirrors the rail's Latest control. */}
          <button
            onClick={() => jump(entries[0].headerIndex)}
            className={`group mb-1 flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
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

          {/* Scrollable axis of days: the rail's spine + nodes, at popover scale. */}
          <nav className="relative min-h-0 flex-1 overflow-y-auto py-1">
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-2 left-[15px] top-2 w-px bg-border"
            />
            {entries.map((e, i) => {
              const showMonth = i === 0 || e.monthKey !== entries[i - 1].monthKey;
              const isActive = i === activeIdx;
              return (
                <Fragment key={e.headerIndex}>
                  {showMonth && (
                    <div className="px-2 pb-0.5 pl-[30px] pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint first:pt-0.5">
                      {e.monthLabel}
                    </div>
                  )}
                  <button
                    ref={isActive ? activeRef : undefined}
                    onClick={() => jump(e.headerIndex)}
                    aria-current={isActive ? "true" : undefined}
                    title={`${e.label} — ${e.count} item${e.count === 1 ? "" : "s"}`}
                    className={`group relative flex w-full items-center gap-2 py-[5px] pl-[30px] pr-2 text-left transition-colors ${
                      isActive ? "text-fg" : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {/* Active pill sits behind the label. */}
                    <span
                      aria-hidden
                      className={`pointer-events-none absolute inset-y-[2px] left-[22px] right-1 rounded-md transition-colors ${
                        isActive ? "bg-accent-dim" : "bg-transparent group-hover:bg-bg-hover/50"
                      }`}
                    />
                    {/* Node on the spine — fill matches the raised popover surface
                        so the hairline reads behind it. */}
                    <span
                      aria-hidden
                      className={`absolute left-[15px] top-1/2 z-[1] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-200 ${
                        isActive
                          ? "border-accent bg-accent shadow-[0_0_0_3px_rgba(123,97,255,0.18)]"
                          : "border-border-strong bg-bg-raised group-hover:border-accent/60"
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
        </div>
      </Popover>
    </div>
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
