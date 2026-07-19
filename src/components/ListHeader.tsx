import { CopyIcon } from "./Icon";

/**
 * Sticky column header for the timeline. It mirrors the Card's exact flex column
 * structure — same gaps, paddings, a transparent 1px border, the shared
 * `card-typecode` / `card-actions-zone` / `card-meta` / `card-copy-label` classes,
 * and an invisible Copy-button clone — so every label lines up precisely with the
 * row column beneath it and collapses in lockstep on narrow layouts (the container
 * queries key off `.list-col-header`, whose content-box width equals a row's).
 *
 * The outer padding (`pl-3 pr-[22px]`) matches the scroll area's `px-3` plus its
 * reserved 10px scrollbar gutter, so the right-hand labels align with the rows even
 * when the list scrolls.
 */
export function ListHeader() {
  const label = "font-mono text-[10px] uppercase tracking-wider text-fg-faint";
  return (
    <div className="shrink-0 border-b border-border bg-bg pl-3 pr-[22px]">
      <div className="list-col-header flex items-center gap-3 border-x border-transparent pl-3 pr-2.5 py-2">
        {/* Selection column (unlabeled) */}
        <span aria-hidden className="lch-checkbox -ml-1 shrink-0" />
        {/* Type — over the TXT/URL/IMG badge */}
        <span className={`card-typecode w-9 shrink-0 ${label}`}>Type</span>
        {/* Content — over the preview */}
        <span className={`min-w-0 flex-1 ${label}`}>Content</span>
        {/* Meta cluster — Time + Used, right-aligned over the row's resting meta */}
        <div className="card-actions-zone flex items-center justify-end">
          <div className={`card-meta flex items-center gap-2.5 pr-1 ${label}`}>
            <span>Time</span>
            <span>Used</span>
          </div>
        </div>
        {/* Copy column (blank): invisible clone reserves the exact button width so the
            meta cluster docks at the same x as the rows, at every breakpoint. */}
        <span
          aria-hidden
          className="invisible flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-xs font-medium"
        >
          <CopyIcon className="h-3.5 w-3.5" />
          <span className="card-copy-label">Copy</span>
        </span>
      </div>
    </div>
  );
}
