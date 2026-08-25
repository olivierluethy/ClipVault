import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Item,
  copyItem,
  copySnippet,
  fuzzySearch,
  hidePalette,
  listItems,
  listSnippets,
  pasteActive,
} from "./api";
import { SearchIcon } from "./components/Icon";
import { formatTime, loadTimeFormat, useTimeFormat } from "./lib/timeFormat";

const TYPE_CODE: Record<Item["item_type"], string> = {
  text: "TXT",
  link: "URL",
  number: "NUM",
  phone: "TEL",
  color: "HEX",
  image: "IMG",
  gif: "GIF",
  file: "FILE",
};

/** How many rows the palette holds. Deliberately small — this is a reflex, not a browser. */
const ROWS = 8;

/** One-line preview. Newlines are shown as a marker rather than collapsing silently, so a
 *  multi-line entry is recognisable as one. */
function oneLine(content: string): string {
  const [first, ...rest] = content.split("\n");
  return rest.length > 0 ? `${first.trim()} ⏎` : first.trim();
}

function Row(props: { item: Item; active: boolean; onPick: () => void; index: number }) {
  const { item, active } = props;
  const timeFmt = useTimeFormat();
  const thumb = item.preview_path ?? item.file_path;
  const isImage = item.item_type === "image" || item.item_type === "gif";
  return (
    <button
      type="button"
      onClick={props.onPick}
      // Selection has to be visible without hover, since the whole point is that the
      // hands stay on the keyboard.
      className={`flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
        active ? "bg-accent-dim text-fg" : "text-fg-muted hover:bg-bg-hover"
      }`}
    >
      <span
        className={`w-6 shrink-0 text-center font-mono text-[10px] tnum ${
          active ? "text-accent" : "text-fg-faint"
        }`}
      >
        {props.index < 9 ? props.index + 1 : ""}
      </span>
      <span className="w-9 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        {item.is_snippet ? "SNIP" : TYPE_CODE[item.item_type]}
      </span>
      {isImage && thumb ? (
        <img src={convertFileSrc(thumb)} alt="" className="h-6 shrink-0 rounded border border-border" />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate font-mono text-sm ${
            item.item_type === "link" ? "text-accent" : ""
          }`}
        >
          {oneLine(item.content ?? "")}
        </span>
      )}
      {isImage && <span className="min-w-0 flex-1 truncate text-sm">Image</span>}
      <span className="shrink-0 font-mono text-[11px] text-fg-faint tnum">
        {formatTime(item.created_at, timeFmt)}
      </span>
    </button>
  );
}

/**
 * The quick-paste palette.
 *
 * The whole design goal is one reflex: hotkey → two letters → Enter → pasted, without
 * looking away from the app being worked in. So it opens with the caret already in the
 * box, never asks for a mouse, and dismisses itself the moment it has done its job.
 */
export default function Palette() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recent entries plus the snippet library — a snippet is exactly the kind of thing
  // worth reaching for from a paste shortcut.
  const loadDefault = useCallback(async () => {
    const [recent, snippets] = await Promise.all([listItems(40), listSnippets()]);
    setItems([...snippets.slice(0, 5), ...recent]);
  }, []);

  useEffect(() => {
    loadDefault();
  }, [loadDefault]);

  // The palette is its own window/module instance — load the clock-format pref here too.
  useEffect(() => {
    loadTimeFormat();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 120);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      loadDefault();
      setSel(0);
      return;
    }
    // Levenshtein ranking here rather than exact matching: at this speed the user is
    // typing from memory and will mistype.
    fuzzySearch(q, 40).then((r) => {
      setItems(r);
      setSel(0);
    });
  }, [debounced, loadDefault]);

  const visible = useMemo(() => items.slice(0, ROWS), [items]);

  /** Hide first, then paste — the target window has to be focused again before the
   *  keystroke lands, otherwise Ctrl+V goes to the palette. */
  const pick = useCallback(async (item: Item) => {
    if (item.is_snippet) {
      await copySnippet(item.id);
    } else {
      await copyItem(item.id);
    }
    await hidePalette();
    setTimeout(() => {
      pasteActive().catch(() => {
        // No input simulation available — the entry is on the clipboard regardless.
      });
    }, 90);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        getCurrentWindow().hide();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, visible.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const item = visible[sel];
        if (item) pick(item);
        return;
      }
      // Alt+N jumps straight to a row. Plain digits are left alone so they can be typed
      // into the search box.
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const item = visible[Number(e.key) - 1];
        if (item) pick(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, sel, pick]);

  // Re-focus whenever the window is shown again; it is reused, not rebuilt.
  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    focus();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-bg-raised">
      <div className="relative shrink-0 border-b border-border px-3 py-2.5">
        <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Paste what?"
          className="w-full rounded-md bg-transparent py-1 pl-8 pr-2 text-sm text-fg placeholder:text-fg-faint focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {visible.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm text-fg-muted">
            {debounced.trim() ? "Nothing close to that." : "Nothing captured yet."}
          </p>
        ) : (
          visible.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              index={i}
              active={i === sel}
              onPick={() => pick(item)}
            />
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        <span>↑↓ choose · ⏎ paste · alt+n jump</span>
        <span>esc close</span>
      </div>
    </div>
  );
}
