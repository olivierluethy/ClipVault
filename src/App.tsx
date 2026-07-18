import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Item, listItems, getPrivacy, setPrivacy, onItemAdded, onPrivacyChanged } from "./api";

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [privacy, setPriv] = useState(false);

  const refresh = () => listItems().then(setItems);

  useEffect(() => {
    refresh();
    getPrivacy().then(setPriv);
    const un1 = onItemAdded(refresh);
    const un2 = onPrivacyChanged(setPriv);
    return () => { un1.then((f) => f()); un2.then((f) => f()); };
  }, []);

  const toggle = async () => { const next = !privacy; await setPrivacy(next); setPriv(next); };

  return (
    <div className="min-h-full p-6">
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">ClipVault <span className="text-accent">Phase 0</span></h1>
        <button
          onClick={toggle}
          className={`px-3 py-1 rounded border border-border text-sm ${privacy ? "bg-accent-dim text-fg" : "text-fg-muted"}`}
        >
          {privacy ? "Privacy: ON" : "Privacy: OFF"}
        </button>
      </header>

      <ul className="space-y-2">
        {items.length === 0 && <li className="text-fg-muted">Nothing captured yet — copy something.</li>}
        {items.map((it) => (
          <li key={it.id} className="bg-bg-card border border-border rounded p-3 flex gap-3 items-center">
            <span className="text-xs uppercase text-accent w-12 shrink-0">{it.item_type}</span>
            {it.item_type === "text" ? (
              <span className="truncate text-sm">{it.content}</span>
            ) : it.file_path ? (
              <img src={convertFileSrc(it.file_path)} alt="" className="max-h-16 rounded" />
            ) : null}
            <span className="ml-auto text-xs text-fg-muted shrink-0">×{it.copy_count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
