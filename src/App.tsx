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
  getHotkey,
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
import { buildDateNav } from "./lib/dateNav";
import { DateRail } from "./components/DateRail";
import { DateFilter } from "./components/DateFilter";
import { Logo } from "./components/Logo";
import { SearchIcon, PlusIcon, SlidersIcon } from "./components/Icon";

// Payload MIME for dragging clipboard items onto user folders.
const DND_TYPE = "application/x-clipvault-items";

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
  const [hotkey, setHotkey] = useState("Ctrl+Alt+V");
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
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

  // Keep the open-hotkey label (shown in the Welcome tips) in sync with settings.
  useEffect(() => {
    getHotkey().then(setHotkey);
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
    setSelectedIds(new Set());
    anchorIndexRef.current = null;
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

  // Checkbox click: shift-click extends a contiguous range from the last anchor.
  const onCheckboxClick = useCallback(
    (it: Item, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && anchorIndexRef.current !== null) {
        selectRange(anchorIndexRef.current, index);
        return;
      }
      toggleSelected(it.id);
      anchorIndexRef.current = index;
    },
    [selectRange, toggleSelected]
  );

  // Item ids under a given date-group header (up to the next header).
  const headerGroupIds = useCallback(
    (headerIndex: number): string[] => {
      const ids: string[] = [];
      for (let i = headerIndex + 1; i < rows.length; i++) {
        const r = rows[i];
        if (r.kind === "header") break;
        ids.push(r.item.id);
      }
      return ids;
    },
    [rows]
  );

  const toggleGroup = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSel = ids.length > 0 && ids.every((id) => next.has(id));
      if (allSel) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(flatItems.map((i) => i.id)));
  }, [flatItems]);

  // Global Ctrl/Cmd+A selects every item in the current view (unless typing).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selectAll]);

  // ─── Drag items → user folders (Task 6). Dragging a selected row drags the whole
  // selection; only user folders are drop targets. ────────────────────────────────
  const handleItemDragStart = useCallback(
    (item: Item, e: React.DragEvent) => {
      const ids =
        selectedIds.has(item.id) && selectedIds.size > 0 ? Array.from(selectedIds) : [item.id];
      e.dataTransfer.setData(DND_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = "copy";
      // Small custom drag preview (count or truncated content).
      const node = document.createElement("div");
      node.textContent =
        ids.length > 1
          ? `${ids.length} items`
          : item.content
          ? item.content.slice(0, 40)
          : item.item_type;
      node.style.cssText =
        "position:absolute;top:-1000px;left:-1000px;padding:6px 10px;background:#1B1B21;color:#ECECF1;border:1px solid #343440;border-radius:8px;font:12px/1.2 'JetBrains Mono Variable',ui-monospace,monospace;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis";
      document.body.appendChild(node);
      e.dataTransfer.setDragImage(node, 12, 12);
      setTimeout(() => node.remove(), 0);
      setDraggingIds(ids);
    },
    [selectedIds]
  );

  const handleItemDragEnd = useCallback(() => {
    setDraggingIds(null);
    setDropTargetId(null);
  }, []);

  const assignDropped = useCallback(
    async (ids: string[], folderId: string) => {
      await Promise.all(ids.map((id) => assignItem(id, folderId)));
      reloadFolders();
      reloadCounts();
      reload();
      if (ids.length > 1) clearSelection();
    },
    [reloadFolders, reloadCounts, reload, clearSelection]
  );

  const folderDropProps = useCallback(
    (folderId: string): React.HTMLAttributes<HTMLDivElement> => ({
      onDragOver: (e) => {
        if (e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropTargetId(folderId);
        }
      },
      onDragLeave: () => setDropTargetId((cur) => (cur === folderId ? null : cur)),
      onDrop: (e) => {
        if (!e.dataTransfer.types.includes(DND_TYPE)) return;
        e.preventDefault();
        try {
          const ids = JSON.parse(e.dataTransfer.getData(DND_TYPE)) as string[];
          if (Array.isArray(ids) && ids.length) assignDropped(ids, folderId);
        } catch {
          /* ignore malformed payload */
        }
        setDropTargetId(null);
      },
    }),
    [assignDropped]
  );

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
    toggleSelect: (it) => toggleSelected(it.id),
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

  // Date-navigation rail: derive the ordered date groups from the timeline rows,
  // and expose a single smooth-scroll used by both the rail and the header
  // calendar picker so their behavior can never drift apart.
  const dateNav = useMemo(() => buildDateNav(rows), [rows]);
  const presentDays = useMemo(() => new Set(dateNav.map((e) => e.isoDay)), [dateNav]);
  const isoDayToHeaderIndex = useMemo(
    () => new Map(dateNav.map((e) => [e.isoDay, e.headerIndex])),
    [dateNav],
  );
  const scrollToHeaderIndex = useCallback(
    (headerIndex: number) => {
      virt.scrollToIndex(headerIndex, { align: "start", behavior: "smooth" });
    },
    [virt],
  );

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

  // Scroll-spy input: the virtualizer row currently at the top of the viewport.
  // Recomputed each render — the virtualizer re-renders as its window shifts, so
  // the rail highlight stays live without a separate scroll listener. The top
  // row is always mounted, so this is correct even for off-screen date groups.
  const vItems = virt.getVirtualItems();
  const scrollOffset = virt.scrollOffset ?? 0;
  let topRowIndex = vItems.length > 0 ? vItems[0].index : 0;
  for (const vi of vItems) {
    if (vi.start <= scrollOffset + 1) topRowIndex = vi.index;
    else break;
  }
  const scrolledAway = scrollOffset > 600;

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
        dropTargetId={dropTargetId}
        folderDropProps={folderDropProps}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 shrink-0">
          <div className="mr-1 flex items-center gap-2 shrink-0">
            <Logo className="h-6 w-6 text-accent" />
            <h1 className="text-[15px] font-semibold tracking-tight">ClipVault</h1>
          </div>
          <div className="relative flex-1 min-w-0">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
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
              placeholder="Search clipboard…"
              className="w-full rounded-md border border-border bg-bg-card py-1.5 pl-8 pr-3 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
          </div>
          <DateFilter
            active={dateRange}
            onApply={applyDateRange}
            onClear={() => setDateRange(null)}
            presentDays={presentDays}
            onNavigate={(iso) => {
              const idx = isoDayToHeaderIndex.get(iso);
              if (idx != null) scrollToHeaderIndex(idx);
            }}
          />
          <button
            onClick={doQuickAdd}
            title="Save the current clipboard now (works even in Privacy mode)"
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <PlusIcon className="h-4 w-4" />
            <span>Add</span>
          </button>
          <button
            onClick={toggle}
            title={privacy ? "Privacy mode on — capture paused" : "Privacy mode off — capturing"}
            className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
              privacy
                ? "border-accent/50 bg-accent-dim text-fg"
                : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${privacy ? "bg-accent" : "bg-fg-faint"}`}
            />
            Privacy
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-fg-muted hover:border-border-strong hover:text-fg"
          >
            <SlidersIcon className="h-4 w-4" />
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
            total={flatItems.length}
            folders={folders}
            onAddToFolder={bulkAddToFolder}
            onSelectAll={selectAll}
            onDelete={bulkDelete}
            onClear={clearSelection}
          />
        )}

        {!isSearching && pinned.length > 0 && (
          <section className="space-y-1.5 border-b border-border px-3 py-3 shrink-0">
            <div className="px-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              Pinned
            </div>
            {pinned.map((it, i) => (
              <div key={it.id} className="relative">
                <Card
                  item={it}
                  copied={copied === it.id}
                  selected={sel === i}
                  multiSelected={selectedIds.has(it.id)}
                  editing={editingId === it.id}
                  folders={folders}
                  loadMemberships={loadMemberships}
                  onToggleFolder={(folderId, checked) => toggleFolder(it, folderId, checked)}
                  onCreateAndAssign={(name) => createAndAssign(it, name)}
                  onBodyClick={(e) => onBodyClick(it, flatIndexById.get(it.id) ?? i, e)}
                  onToggleSelect={(e) => onCheckboxClick(it, flatIndexById.get(it.id) ?? i, e)}
                  onDragStart={(e) => handleItemDragStart(it, e)}
                  onDragEnd={handleItemDragEnd}
                  dragging={!!draggingIds && draggingIds.includes(it.id)}
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

        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1">
        <div ref={parentRef} className="flex-1 overflow-auto px-3 py-3 min-h-0">
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
              const groupIds = row.kind === "header" ? headerGroupIds(v.index) : [];
              const groupAll = groupIds.length > 0 && groupIds.every((id) => selectedIds.has(id));
              const groupSome = groupIds.some((id) => selectedIds.has(id));
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
                    <div className="sticky top-0 bg-bg py-1 z-10 flex items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`Select all in ${row.label}`}
                        title={`Select all in ${row.label}`}
                        checked={groupAll}
                        ref={(el) => {
                          if (el) el.indeterminate = groupSome && !groupAll;
                        }}
                        onChange={() => toggleGroup(groupIds)}
                        className="h-3.5 w-3.5 accent-accent cursor-pointer"
                      />
                      <span className="text-xs uppercase text-fg-muted">{row.label}</span>
                    </div>
                  ) : (
                    <div className="relative pb-1.5">
                      <Card
                        item={row.item}
                        copied={copied === row.item.id}
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
                        onToggleSelect={(e) => onCheckboxClick(row.item, flatIndex, e)}
                        onDragStart={(e) => handleItemDragStart(row.item, e)}
                        onDragEnd={handleItemDragEnd}
                        dragging={!!draggingIds && draggingIds.includes(row.item.id)}
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
            {scrolledAway && (
              <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2">
                <button
                  onClick={() => scrollToHeaderIndex(0)}
                  title="Scroll back to the newest items"
                  className="pointer-events-auto flex animate-fade-in-up items-center gap-1.5 rounded-full border border-border-strong bg-bg-raised/95 py-1.5 pl-2.5 pr-3.5 text-xs font-medium text-fg shadow-lg backdrop-blur transition-colors hover:border-accent/60"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-accent" aria-hidden>
                    <path
                      d="M8 13V3.5M8 3.5 4 7.5M8 3.5 12 7.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Jump to latest
                </button>
              </div>
            )}
          </div>
          <DateRail entries={dateNav} topRowIndex={topRowIndex} onJump={scrollToHeaderIndex} />
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
              <li>Press <span className="text-fg font-medium">{hotkey}</span> anytime to open it.</li>
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
