import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Item,
  copyItem,
  copyItemClean,
  copyItemPlain,
  deleteItem,
  restoreItem,
  setPinned,
  updateContent,
  getPrivacy,
  setPrivacy,
  quickAdd,
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
  search,
  getSettingStr,
  setSettingStr,
  openUrl,
  hideWindow,
} from "./api";
import { Card } from "./components/Card";
import { ZoomModal } from "./components/ZoomModal";
import { UndoToast } from "./components/UndoToast";
import { Sidebar } from "./components/Sidebar";
import { BulkActionBar } from "./components/BulkActionBar";
import { Settings } from "./components/Settings";
import { QrModal } from "./components/QrModal";
import { TextModal } from "./components/TextModal";
import { useTimeline, DateRange } from "./hooks/useTimeline";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { toRows } from "./lib/dates";
import { DateFilter } from "./components/DateFilter";
import { Logo } from "./components/Logo";

export default function App() {
  const [folder, setFolder] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const { pinned, rows: folderRows, flatItems: folderFlatItems, reload, loadMore } = useTimeline(folder, dateRange);
  const [privacy, setPriv] = useState(false);
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrText, setQrText] = useState<string | null>(null);
  const [expandItem, setExpandItem] = useState<Item | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Item[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  // First-run welcome: show once, then persist the "onboarded" flag.
  useEffect(() => {
    getSettingStr("onboarded").then((v) => {
      if (v !== "1") setShowWelcome(true);
    });
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    setSettingStr("onboarded", "1");
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

  // Debounce the raw query into debouncedQuery so we don't hit the DB on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const isSearching = debouncedQuery.trim().length > 0;

  const runSearch = useCallback(async () => {
    const q = debouncedQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearchResults(await search(q));
  }, [debouncedQuery]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  // Keep search results fresh while a query is active (e.g. new items captured).
  useEffect(() => {
    if (!isSearching) return;
    const un = onItemAdded(runSearch);
    return () => {
      un.then((f) => f());
    };
  }, [isSearching, runSearch]);

  // Global Ctrl/Cmd+F focuses the search box.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setSearchResults([]);
  }, []);

  const handleSelectFolder = useCallback((f: string) => {
    clearSearch();
    setDateRange(null);
    setFolder(f);
  }, [clearSearch]);

  // Applying a date range replaces the folder/search view with an all-types view of
  // that window (kept mutually exclusive to stay easy to reason about).
  const applyDateRange = useCallback((r: DateRange) => {
    clearSearch();
    setFolder("all");
    setDateRange(r);
  }, [clearSearch]);

  const rows = isSearching ? toRows(searchResults) : folderRows;
  const flatItems = isSearching ? searchResults : folderFlatItems;

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

  const cleanCopy = useCallback(async (it: Item) => {
    await copyItemClean(it.id);
    setCopied(it.id);
    setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1200);
  }, []);

  const plainCopy = useCallback(async (it: Item) => {
    await copyItemPlain(it.id);
    setCopied(it.id);
    setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1200);
  }, []);

  const del = useCallback(
    async (it: Item) => {
      await deleteItem(it.id);
      setPendingDeleteIds([it.id]);
      reload();
      reloadCounts();
      if (isSearching) runSearch();
    },
    [reload, reloadCounts, isSearching, runSearch]
  );

  const pin = useCallback(
    async (it: Item) => {
      await setPinned(it.id, !it.pinned);
      reload();
      if (isSearching) runSearch();
    },
    [reload, isSearching, runSearch]
  );

  const edit = useCallback((it: Item) => {
    if (["text", "link", "number", "color"].includes(it.item_type)) setEditingId(it.id);
  }, []);

  const saveEdit = useCallback(
    (id: string, content: string) => {
      updateContent(id, content).then(() => {
        setEditingId(null);
        reload();
        if (isSearching) runSearch();
      });
    },
    [reload, isSearching, runSearch]
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

  const copyAndHide = useCallback(
    async (it: Item) => {
      await copyItem(it.id);
      await hideWindow();
    },
    []
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
    copyAndHide,
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

  const quickMsgTimer = useRef<number | null>(null);
  const doQuickAdd = useCallback(async () => {
    const added = await quickAdd();
    // A successful add refreshes the timeline via the `item-added` event listeners;
    // show a brief confirmation either way (esp. useful while privacy mode is on).
    setQuickMsg(added ? "Added current clipboard ✓" : "Clipboard empty — nothing to add");
    if (quickMsgTimer.current) window.clearTimeout(quickMsgTimer.current);
    quickMsgTimer.current = window.setTimeout(() => setQuickMsg(null), 1600);
  }, []);

  const isEmpty = isSearching ? rows.length === 0 : rows.length === 0 && pinned.length === 0;

  return (
    <div className="h-screen flex">
      <Sidebar
        counts={counts}
        selected={folder}
        onSelect={handleSelectFolder}
        folders={folders}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex items-center gap-4 p-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            <Logo className="w-6 h-6 text-accent" />
            <h1 className="text-lg font-semibold">ClipVault</h1>
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.blur();
                clearSearch();
              }
            }}
            placeholder="Search…"
            className="flex-1 min-w-0 px-3 py-1 rounded border border-border bg-bg-raised text-fg text-sm placeholder:text-fg-muted focus:outline-none focus:border-accent"
          />
          <DateFilter
            active={dateRange}
            onApply={applyDateRange}
            onClear={() => setDateRange(null)}
          />
          <button
            onClick={doQuickAdd}
            title="Save the current clipboard now (works even in Privacy mode)"
            className="px-3 py-1 rounded border border-border text-sm shrink-0 text-fg-muted hover:text-fg hover:border-accent"
          >
            + Add current
          </button>
          <button
            onClick={toggle}
            className={`px-3 py-1 rounded border border-border text-sm shrink-0 ${
              privacy ? "bg-accent-dim text-fg" : "text-fg-muted"
            }`}
          >
            {privacy ? "Privacy: ON" : "Privacy: OFF"}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="px-2 py-1 rounded border border-border text-sm shrink-0 text-fg-muted hover:text-fg hover:border-accent"
          >
            ⚙
          </button>
        </header>

        {isSearching && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 text-sm text-fg-muted">
            <span>
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for &lsquo;{debouncedQuery.trim()}&rsquo;
            </span>
            <button onClick={clearSearch} className="text-accent hover:underline">
              Clear
            </button>
          </div>
        )}

        {!isSearching && dateRange && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 text-sm text-fg-muted">
            <span>Showing items from <span className="text-fg">{dateRange.label}</span></span>
            <button onClick={() => setDateRange(null)} className="text-accent hover:underline">
              Clear
            </button>
          </div>
        )}

        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            folders={folders}
            onAddToFolder={bulkAddToFolder}
            onDelete={bulkDelete}
            onClear={clearSelection}
          />
        )}

        {!isSearching && pinned.length > 0 && (
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
                  onCleanCopy={() => {
                    setSel(i);
                    cleanCopy(it);
                  }}
                  onPlainCopy={() => {
                    setSel(i);
                    plainCopy(it);
                  }}
                  onDelete={() => del(it)}
                  onPin={() => pin(it)}
                  onZoom={() => setZoom(it)}
                  onQr={() => setQrText(it.content ?? "")}
                  onOpenLink={() => it.content && openUrl(it.content)}
                  onExpandText={() => setExpandItem(it)}
                  onStartEdit={() => setEditingId(it.id)}
                  onSaveEdit={(c) => saveEdit(it.id, c)}
                  onCancelEdit={() => setEditingId(null)}
                />
              </div>
            ))}
          </section>
        )}

        <div ref={parentRef} className="flex-1 overflow-auto p-4 min-h-0">
          {isEmpty && (
            <p className="text-fg-muted">
              {isSearching
                ? "No results."
                : dateRange
                ? "No items in this date range."
                : "Nothing captured yet — copy something."}
            </p>
          )}
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
                        onCleanCopy={() => cleanCopy(row.item)}
                        onPlainCopy={() => plainCopy(row.item)}
                        onDelete={() => del(row.item)}
                        onPin={() => pin(row.item)}
                        onZoom={() => setZoom(row.item)}
                        onQr={() => setQrText(row.item.content ?? "")}
                        onOpenLink={() => row.item.content && openUrl(row.item.content)}
                        onExpandText={() => setExpandItem(row.item)}
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

      {quickMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border border-border bg-bg-raised text-sm text-fg shadow-lg">
          {quickMsg}
        </div>
      )}

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          onPrivacyTimed={() => setPriv(true)}
        />
      )}

      <QrModal text={qrText} onClose={() => setQrText(null)} />

      <TextModal
        text={expandItem?.content ?? null}
        onClose={() => setExpandItem(null)}
        onCopy={() => {
          if (expandItem) copy(expandItem);
          setExpandItem(null);
        }}
      />

      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md rounded-xl border border-border bg-bg-raised p-6 shadow-2xl space-y-3">
            <h2 className="text-lg font-semibold">Welcome to ClipVault 📋</h2>
            <p className="text-sm text-fg-muted">
              ClipVault quietly saves what you copy — text, links, colors, numbers, and
              images — so you can find and reuse it later.
            </p>
            <ul className="text-sm text-fg-muted space-y-1 list-disc pl-5">
              <li>Press <span className="text-fg font-medium">Ctrl+Alt+V</span> anytime to open it.</li>
              <li>Use <span className="text-fg font-medium">Privacy</span> to pause capture; <span className="text-fg font-medium">+ Add current</span> saves one item on demand.</li>
              <li><span className="text-fg font-medium">Ctrl+F</span> searches; the <span className="text-fg font-medium">⚙</span> menu has retention, backups, and export.</li>
            </ul>
            <div className="flex justify-end pt-1">
              <button
                onClick={dismissWelcome}
                className="rounded border border-accent bg-accent-dim/40 px-4 py-1.5 text-sm text-fg hover:bg-accent-dim"
              >
                Get started
              </button>
            </div>
          </div>
        </div>
      )}

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
