import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Item, copyItem, listByType, onItemAdded } from "./api";
import { toCssColor } from "./lib/color";
import { formatTime, loadTimeFormat, useTimeFormat } from "./lib/timeFormat";

// Category id → human label and the type strings it covers. "image" merges GIFs.
const CATEGORIES: Record<string, { label: string; types: string[] }> = {
  text: { label: "Text", types: ["text"] },
  link: { label: "Links", types: ["link"] },
  number: { label: "Numbers", types: ["number"] },
  phone: { label: "Phone Numbers", types: ["phone"] },
  color: { label: "Colors", types: ["color"] },
  image: { label: "Images & GIFs", types: ["image", "gif"] },
  file: { label: "Files", types: ["file"] },
};

function sortDesc(items: Item[]): Item[] {
  return [...items].sort((a, b) =>
    b.created_at !== a.created_at ? b.created_at - a.created_at : b.id.localeCompare(a.id)
  );
}

/** A standalone window showing one live-updating library category (issue #5). The
 *  category is read from the window's `?type=` URL parameter. */
export default function CategoryWindow() {
  const type = useMemo(
    () => new URLSearchParams(window.location.search).get("type") ?? "text",
    []
  );
  const meta = CATEGORIES[type] ?? { label: type, types: [type] };
  const [items, setItems] = useState<Item[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const timeFmt = useTimeFormat();

  const reload = useCallback(async () => {
    const pages = await Promise.all(meta.types.map((t) => listByType(t, 500)));
    setItems(sortDesc(pages.flat()));
  }, [meta.types]);

  useEffect(() => {
    loadTimeFormat();
    reload();
    // Live update: capture in the main app emits `item-added` to every window.
    const un = onItemAdded(reload);
    return () => {
      un.then((f) => f());
    };
  }, [reload]);

  const copy = async (it: Item) => {
    await copyItem(it.id);
    setCopied(it.id);
    window.setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1000);
  };

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h1 className="text-sm font-semibold">{meta.label}</h1>
        <span className="font-mono text-xs text-fg-faint tnum">{items.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="mt-10 text-center text-sm text-fg-muted">Nothing here yet.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => copy(it)}
                  title="Copy"
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                    copied === it.id ? "bg-accent-dim text-fg" : "hover:bg-bg-hover"
                  }`}
                >
                  <Preview item={it} />
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-faint tnum">
                    {copied === it.id ? "Copied ✓" : formatTime(it.created_at, timeFmt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Preview({ item }: { item: Item }) {
  if (item.item_type === "color") {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className="h-5 w-5 shrink-0 rounded-md border border-border-strong"
          style={{ backgroundColor: toCssColor(item.content) ?? "transparent" }}
        />
        <span className="truncate font-mono text-sm">{item.content}</span>
      </span>
    );
  }
  if (item.item_type === "image" || item.item_type === "gif") {
    const thumb = item.preview_path ?? item.file_path;
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {thumb ? (
          <img src={convertFileSrc(thumb)} alt="" className="h-8 shrink-0 rounded border border-border" />
        ) : null}
        <span className="truncate text-sm text-fg-muted">Image</span>
      </span>
    );
  }
  return (
    <span
      className={`min-w-0 flex-1 truncate font-mono text-sm ${
        item.item_type === "link" ? "text-accent" : "text-fg/90"
      }`}
    >
      {item.content}
    </span>
  );
}
