import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Item,
  copyItem,
  deleteItem,
  restoreItem,
  setPinned,
  updateContent,
  getPrivacy,
  setPrivacy,
  onPrivacyChanged,
  folderCounts,
  onItemAdded,
  FolderDto,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
} from "./api";
import { Card } from "./components/Card";
import { ZoomModal } from "./components/ZoomModal";
import { UndoToast } from "./components/UndoToast";
import { Sidebar } from "./components/Sidebar";
import { useTimeline } from "./hooks/useTimeline";
import { useKeyboardNav } from "./hooks/useKeyboardNav";

export default function App() {
  const [folder, setFolder] = useState("all");
  const { pinned, rows, flatItems, reload, loadMore } = useTimeline(folder);
  const [privacy, setPriv] = useState(false);
  const [zoom, setZoom] = useState<Item | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);

  const reloadCounts = useCallback(async () => {
    const list = await folderCounts();
    setCounts(Object.fromEntries(list));
  }, []);

  const reloadFolders = useCallback(async () => {
    setFolders(await listFolders());
  }, []);

  useEffect(() => {
    getPrivacy().then(setPriv);
    const un = onPrivacyChanged(setPriv);
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    reloadCounts();
    const un = onItemAdded(reloadCounts);
    return () => {
      un.then((f) => f());
    };
  }, [reloadCounts]);

  useEffect(() => {
    reloadFolders();
    const un = onItemAdded(reloadFolders);
    return () => {
      un.then((f) => f());
    };
  }, [reloadFolders]);

  const handleCreateFolder = useCallback(
    async (name: string) => {
      await createFolder(name);
      reloadFolders();
    },
    [reloadFolders]
  );

  const handleRenameFolder = useCallback(
    async (id: string, name: string) => {
      await renameFolder(id, name);
      reloadFolders();
    },
    [reloadFolders]
  );

  const handleDeleteFolder = useCallback(
    async (id: string, deleteItems: boolean) => {
      await deleteFolder(id, deleteItems);
      if (folder === `user:${id}`) setFolder("all");
      reloadFolders();
      reloadCounts();
      reload();
    },
    [folder, reloadFolders, reloadCounts, reload]
  );

  const copy = useCallback(async (it: Item) => {
    await copyItem(it.id);
    setCopied(it.id);
    setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1200);
  }, []);

  const del = useCallback(
    async (it: Item) => {
      await deleteItem(it.id);
      setPendingDelete(it);
      reload();
      reloadCounts();
    },
    [reload, reloadCounts]
  );

  const pin = useCallback(
    async (it: Item) => {
      await setPinned(it.id, !it.pinned);
      reload();
    },
    [reload]
  );

  const edit = useCallback((it: Item) => {
    if (["text", "link", "number", "color"].includes(it.item_type)) setEditingId(it.id);
  }, []);

  const saveEdit = useCallback(
    (id: string, content: string) => {
      updateContent(id, content).then(() => {
        setEditingId(null);
        reload();
      });
    },
    [reload]
  );

  const { sel, setSel } = useKeyboardNav(flatItems, {
    copy,
    del,
    pin,
    edit,
    close: () => {
      setZoom(null);
      setEditingId(null);
    },
  });

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 400) loadMore();
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [loadMore]);

  const toggle = async () => {
    const next = !privacy;
    await setPrivacy(next);
    setPriv(next);
  };

  const isEmpty = rows.length === 0 && pinned.length === 0;

  const flatIndexById = useMemo(() => {
    const m = new Map<string, number>();
    flatItems.forEach((it, i) => m.set(it.id, i));
    return m;
  }, [flatItems]);

  return (
    <div className="h-screen flex">
      <Sidebar
        counts={counts}
        selected={folder}
        onSelect={setFolder}
        folders={folders}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold">ClipVault</h1>
          <button
            onClick={toggle}
            className={`px-3 py-1 rounded border border-border text-sm ${
              privacy ? "bg-accent-dim text-fg" : "text-fg-muted"
            }`}
          >
            {privacy ? "Privacy: ON" : "Privacy: OFF"}
          </button>
        </header>

        {pinned.length > 0 && (
          <section className="p-4 border-b border-border space-y-2 shrink-0">
            <div className="text-xs uppercase text-fg-muted">Pinned</div>
            {pinned.map((it, i) => (
              <div key={it.id} className="relative">
                {copied === it.id && (
                  <span className="absolute right-2 top-2 text-xs text-accent z-10">Copied ✓</span>
                )}
                <Card
                  item={it}
                  selected={sel === i}
                  editing={editingId === it.id}
                  onCopy={() => {
                    setSel(i);
                    copy(it);
                  }}
                  onDelete={() => del(it)}
                  onPin={() => pin(it)}
                  onZoom={() => setZoom(it)}
                  onStartEdit={() => setEditingId(it.id)}
                  onSaveEdit={(c) => saveEdit(it.id, c)}
                  onCancelEdit={() => setEditingId(null)}
                />
              </div>
            ))}
          </section>
        )}

        <div ref={parentRef} className="flex-1 overflow-auto p-4 min-h-0">
          {isEmpty && <p className="text-fg-muted">Nothing captured yet — copy something.</p>}
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((v) => {
              const row = rows[v.index];
              const flatIndex = row.kind === "item" ? flatIndexById.get(row.item.id) ?? -1 : -1;
              return (
                <div
                  key={v.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${v.start}px)`,
                  }}
                  ref={virt.measureElement}
                  data-index={v.index}
                >
                  {row.kind === "header" ? (
                    <div className="sticky top-0 bg-bg py-1 text-xs uppercase text-fg-muted z-10">
                      {row.label}
                    </div>
                  ) : (
                    <div className="relative pb-2">
                      {copied === row.item.id && (
                        <span className="absolute right-2 top-2 text-xs text-accent z-10">Copied ✓</span>
                      )}
                      <Card
                        item={row.item}
                        selected={flatIndex >= 0 && sel === flatIndex}
                        editing={editingId === row.item.id}
                        onCopy={() => copy(row.item)}
                        onDelete={() => del(row.item)}
                        onPin={() => pin(row.item)}
                        onZoom={() => setZoom(row.item)}
                        onStartEdit={() => setEditingId(row.item.id)}
                        onSaveEdit={(c) => saveEdit(row.item.id, c)}
                        onCancelEdit={() => setEditingId(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ZoomModal item={zoom} onClose={() => setZoom(null)} />
      <UndoToast
        open={!!pendingDelete}
        onUndo={async () => {
          if (pendingDelete) {
            await restoreItem(pendingDelete.id);
            setPendingDelete(null);
            reload();
            reloadCounts();
          }
        }}
        onExpire={() => setPendingDelete(null)}
      />
    </div>
  );
}
