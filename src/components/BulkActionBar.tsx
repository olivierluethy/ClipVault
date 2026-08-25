import { useEffect, useRef, useState } from "react";
import { FolderDto } from "../api";
import { LayersIcon, CheckIcon, TrashIcon, FolderPlusIcon, XIcon } from "./Icon";

function FolderDropdown(props: {
  folders: FolderDto[];
  onPick: (folderId: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [props.onClose]);

  return (
    <div
      ref={menuRef}
      className="absolute left-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto rounded border border-border bg-bg-raised shadow-lg p-1"
    >
      {props.folders.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-fg-muted">No folders yet</div>
      ) : (
        props.folders.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              props.onPick(f.id);
              props.onClose();
            }}
            className="w-full text-left rounded px-2 py-1.5 text-sm text-fg hover:bg-bg-card truncate"
          >
            {f.name}
          </button>
        ))
      )}
    </div>
  );
}

// Preset separators, plus a "custom" mode with a free-text field. Values are the
// exact strings joined between items.
const PRESETS: { key: string; label: string; value: string }[] = [
  { key: "newline", label: "New line", value: "\n" },
  { key: "comma", label: "Comma + space", value: ", " },
  { key: "space", label: "Single space", value: " " },
];

const SEP_STORAGE_KEY = "clipvault.mergeSeparator";

/** Recall the last-used separator (raw value). Defaults to a newline. */
function loadSeparator(): string {
  try {
    const v = localStorage.getItem(SEP_STORAGE_KEY);
    return v ?? "\n";
  } catch {
    return "\n";
  }
}

function MergePopover(props: {
  mergeableCount: number;
  skippedCount: number;
  onMerge: (separator: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = loadSeparator();
  const initialPreset = PRESETS.find((p) => p.value === initial);
  const [presetKey, setPresetKey] = useState<string>(initialPreset ? initialPreset.key : "custom");
  const [custom, setCustom] = useState<string>(initialPreset ? "" : initial);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) props.onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [props.onClose]);

  const resolvedSeparator = () => {
    if (presetKey === "custom") return custom;
    return PRESETS.find((p) => p.key === presetKey)?.value ?? "\n";
  };

  const doMerge = () => {
    const sep = resolvedSeparator();
    try {
      localStorage.setItem(SEP_STORAGE_KEY, sep);
    } catch {
      /* non-fatal: separator just won't be remembered */
    }
    props.onMerge(sep);
    props.onClose();
  };

  return (
    <div
      ref={menuRef}
      className="absolute left-0 top-full mt-1 z-30 w-64 rounded-lg border border-border bg-bg-raised p-2 shadow-2xl shadow-black/50"
    >
      <div className="px-1 pb-1.5 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
        Separator
      </div>
      <div className="space-y-0.5">
        {PRESETS.map((p) => (
          <label
            key={p.key}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-bg-hover"
          >
            <input
              type="radio"
              name="merge-sep"
              checked={presetKey === p.key}
              onChange={() => setPresetKey(p.key)}
              className="accent-accent"
            />
            <span>{p.label}</span>
          </label>
        ))}
        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-bg-hover">
          <input
            type="radio"
            name="merge-sep"
            checked={presetKey === "custom"}
            onChange={() => setPresetKey("custom")}
            className="accent-accent"
          />
          <span>Custom</span>
        </label>
        {presetKey === "custom" && (
          <input
            type="text"
            value={custom}
            autoFocus
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doMerge();
            }}
            placeholder="e.g.  •  or  ; "
            className="mt-0.5 w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        )}
      </div>

      {props.skippedCount > 0 && (
        <p className="mt-2 px-1 text-xs text-fg-muted">
          {props.skippedCount} non-text item{props.skippedCount === 1 ? "" : "s"} will be skipped.
        </p>
      )}

      <button
        onClick={doMerge}
        className="mt-2 w-full rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent hover:text-bg"
      >
        Merge {props.mergeableCount} item{props.mergeableCount === 1 ? "" : "s"} &amp; copy
      </button>
    </div>
  );
}

export function BulkActionBar(props: {
  count: number;
  total: number;
  mergeableCount: number;
  folders: FolderDto[];
  onMerge: (separator: string) => void;
  onAddToFolder: (folderId: string) => void;
  onSelectAll: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);

  const canMerge = props.mergeableCount >= 2;
  const mergeTitle = canMerge
    ? "Combine the selected text items into one new entry"
    : props.mergeableCount === 1
    ? "Select at least 2 text items to merge"
    : "Select text items to merge (images can't be merged)";

  // Shared button shell so every bulk action reads as one consistent, prominent group.
  const btn =
    "flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-bg-card/60 px-2.5 py-1 text-sm text-fg transition-colors hover:border-accent/60 hover:bg-bg-card";

  return (
    // An accent-tinted bar with a left accent rail makes the selection state
    // unmistakable (issue #10, stories 4 & 8).
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-accent/40 bg-accent-dim/30 px-3 py-2 shrink-0 sm:px-4">
      <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent" aria-hidden />

      {/* Selection state — a prominent accent badge, not a quiet label. */}
      <span className="mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-sm font-semibold text-accent">
        <CheckIcon className="h-4 w-4" />
        {props.count} selected
      </span>

      {props.count < props.total && (
        <button onClick={props.onSelectAll} className={btn}>
          <LayersIcon className="h-4 w-4" />
          Select all {props.total}
        </button>
      )}

      {/* Thin divider between "what's selected" and "what you can do with it". */}
      <span className="mx-1 hidden h-5 w-px shrink-0 bg-accent/30 sm:block" aria-hidden />

      <div className="relative shrink-0">
        <button
          onClick={() => canMerge && setMergeMenuOpen((v) => !v)}
          disabled={!canMerge}
          title={mergeTitle}
          className={`${btn} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border-strong disabled:hover:bg-bg-card/60`}
        >
          <LayersIcon className="h-4 w-4" />
          Merge{canMerge ? ` ${props.mergeableCount}` : ""} ▾
        </button>
        {mergeMenuOpen && canMerge && (
          <MergePopover
            mergeableCount={props.mergeableCount}
            skippedCount={props.count - props.mergeableCount}
            onMerge={props.onMerge}
            onClose={() => setMergeMenuOpen(false)}
          />
        )}
      </div>
      <div className="relative shrink-0">
        <button onClick={() => setFolderMenuOpen((v) => !v)} className={btn}>
          <FolderPlusIcon className="h-4 w-4" />
          Add to folder ▾
        </button>
        {folderMenuOpen && (
          <FolderDropdown
            folders={props.folders}
            onPick={props.onAddToFolder}
            onClose={() => setFolderMenuOpen(false)}
          />
        )}
      </div>
      <button
        onClick={props.onDelete}
        className={`${btn} hover:border-red-500/60 hover:text-red-300`}
      >
        <TrashIcon className="h-4 w-4" />
        Delete
      </button>

      {/* Clear selection sits WITH the other controls (not floated away) and is a real
          bordered button so it's easy to find — issue #10, stories 1 & 3. */}
      <button
        onClick={props.onClear}
        title="Deselect all (Esc)"
        className={`${btn} text-fg-muted`}
      >
        <XIcon className="h-4 w-4" />
        Clear selection
      </button>
    </div>
  );
}
