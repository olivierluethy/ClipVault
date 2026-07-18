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
  assignItem,
  unassignItem,
  foldersForItem,
} from "./api";
import { Card } from "./components/Card";
import { ZoomModal } from "./components/ZoomModal";
import { UndoToast } from "./components/UndoToast";
import { Sidebar } from "./components/Sidebar";
import { BulkActionBar } from "./components/BulkActionBar";
import { useTimeline } from "./hooks/useTimeline";
import { useKeyboardNav } from "./hooks/useKeyboardNav";

export default function App() {
  const [folder, setFolder] = useState("all");
  const { pinned, rows, flatItems, reload, loadMore } = useTimeline(folder);
  const [privacy, setPriv] = useState(false);
  const [zoom, setZoom] = useState<Item | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);
  const anchorIndexRef = useRef<number | null>(null);

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
      setPendingDeleteIds([it.id]);
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

  const loadMemberships = useCallback((itemId: string) => foldersForItem(itemId), []);

  const toggleFolder = useCallback(
    async (it: Item, folderId: string, checked: boolean) => {
      if (checked) await assignItem(it.id, folderId);
      else await unassignItem(it.id, folderId);
      reloadFolders();
      reload();
    },
    [reloadFolders, reload]
  );

  const createAndAssign = useCallback(
    async (it: Item, name: string) => {
      const id = await createFolder(name);
      await assignItem(it.id, id);
      reloadFolders();
      reload();
    },
    [reloadFolders, reload]
  );

  const flatIndexById = useMemo(() => {
    const m = new Map<string, number>();
    flatItems.forEach((it, i) => m.set(it.id, i));
    return m;
  }, [flatItems]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectRange = useCallback(
    (fromIndex: number, toIndex: number) => {
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const it = flatItems[i];
          if (it) next.add(it.id);
        }
        return next;
      });
    },
    [flatItems]
  );

  const onBodyClick = useCallback(
    (it: Item, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && anchorIndexRef.current !== null) {
        selectRange(anchorIndexRef.current, index);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        toggleSelected(it.id);
        anchorIndexRef.current = index;
        return;
      }
      if (selectedIds.size > 0) {
        toggleSelected(it.id);
        anchorIndexRef.current = index;
        return;
      }
      if (index >= 0) setSel(index);
      copy(it);
      anchorIndexRef.current = index;
    },
    [selectedIds, toggleSelected, selectRange, copy]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    anchorIndexRef.current = null;
  }, []);

  const bulkAddToFolder = useCallback(
    async (folderId: string) => {
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) => assignItem(id, folderId)));
      clearSelection();
      reloadFolders();
      reloadCounts();
      reload();
    },
    [selectedIds, clearSelection, reloadFolders, reloadCounts, reload]
  );

  const bulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => deleteItem(id)));
    setPendingDeleteIds(ids);
    clearSelection();
    reload();
    reloadCounts();
  }, [selectedIds, clearSelection, reload, reloadCounts]);

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

        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            folders={folders}
            onAddToFolder={bulkAddToFolder}
            onDelete={bulkDelete}
            onClear={clearSelection}
          />
        )}

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
                  multiSelected={selectedIds.has(it.id)}
                  editing={editingId === it.id}
                  folders={folders}
                  loadMemberships={loadMemberships}
                  onToggleFolder={(folderId, checked) => toggleFolder(it, folderId, checked)}
                  onCreateAndAssign={(name) => createAndAssign(it, name)}
                  onBodyClick={(e) => onBodyClick(it, flatIndexById.get(it.id) ?? i, e)}
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
                        multiSelected={selectedIds.has(row.item.id)}
                        editing={editingId === row.item.id}
                        folders={folders}
                        loadMemberships={loadMemberships}
                        onToggleFolder={(folderId, checked) =>
                          toggleFolder(row.item, folderId, checked)
                        }
                        onCreateAndAssign={(name) => createAndAssign(row.item, name)}
                        onBodyClick={(e) => onBodyClick(row.item, flatIndex, e)}
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
        open={!!pendingDeleteIds && pendingDeleteIds.length > 0}
        label={
          pendingDeleteIds && pendingDeleteIds.length > 1
            ? `${pendingDeleteIds.length} deleted`
            : "Item deleted"
        }
        onUndo={async () => {
          if (pendingDeleteIds) {
            await Promise.all(pendingDeleteIds.map((id) => restoreItem(id)));
            setPendingDeleteIds(null);
            reload();
            reloadCounts();
          }
        }}
        onExpire={() => setPendingDeleteIds(null)}
      />
    </div>
  );
}
