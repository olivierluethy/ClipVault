import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Item,
  copyItem,
  copyItemClean,
  deleteItem,
  restoreItem,
  setPinned,
  setItemExpiry,
  updateContent,
  getPrivacy,
  setPrivacy,
  quickAdd,
  onPrivacyChanged,
  folderCounts,
  frequentCount,
  duplicateCount,
  snippetCount,
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
  fuzzySearch,
  getSettingStr,
  setSettingStr,
  openUrl,
  hideWindow,
  getHotkey,
  saveTextItem,
  pasteActive,
} from "./api";
import { Card } from "./components/Card";
import { CodeModal } from "./components/CodeModal";
import { detectCode } from "./lib/codeDetect";
import { ZoomModal } from "./components/ZoomModal";
import { UndoToast } from "./components/UndoToast";
import { Sidebar } from "./components/Sidebar";
import { BulkActionBar } from "./components/BulkActionBar";
import { Settings } from "./components/Settings";
import { QrModal } from "./components/QrModal";
import { TextModal } from "./components/TextModal";
import { useTimeline, DateRange } from "./hooks/useTimeline";
import { useKeyboardNav } from "./hooks/useKeyboardNav";
import { toRows, toDomainRows } from "./lib/dates";
import { buildDateNav } from "./lib/dateNav";
import { DateRail } from "./components/DateRail";
import { DateNavMenu } from "./components/DateNavMenu";
import { ListHeader } from "./components/ListHeader";
import { DateFilter } from "./components/DateFilter";
import { Logo } from "./components/Logo";
import { SearchIcon, PlusIcon, SlidersIcon, MenuIcon, ShieldIcon, FlameIcon, XIcon } from "./components/Icon";
import Duplicates from "./components/Duplicates";
import Snippets from "./components/Snippets";

// Payload MIME for dragging clipboard items onto user folders.
const DND_TYPE = "application/x-clipvault-items";

// Item types whose text can be combined by Multi-Copy-Merge (images/gifs excluded).
const MERGE_TYPES: Item["item_type"][] = ["text", "link", "number", "color"];

export default function App() {
  const [folder, setFolder] = useState("all");
  const [groupByDomain, setGroupByDomain] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
  const { pinned, rows: folderRows, flatItems: folderFlatItems, reload, loadMore } = useTimeline(folder, dateRange);
  const [privacy, setPriv] = useState(false);
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrText, setQrText] = useState<string | null>(null);
  const [expandItem, setExpandItem] = useState<Item | null>(null);
  const [codeItem, setCodeItem] = useState<Item | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [hotkey, setHotkey] = useState("Ctrl+Alt+V");
  const [autoPaste, setAutoPaste] = useState(false);
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Item[]>([]);
  const [fuzzy, setFuzzy] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState<Item | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [freqCount, setFreqCount] = useState(0);
  const [dupCount, setDupCount] = useState(0);
  const [snipCount, setSnipCount] = useState(0);
  const [snipRefresh, setSnipRefresh] = useState(0);
  // Bumped to make the Similar view re-scan after something outside it changed the
  // history (an undone removal, a capture).
  const [dupRefresh, setDupRefresh] = useState(0);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);
  const anchorIndexRef = useRef<number | null>(null);
  // Drag-to-select down the checkbox column. `select` fixes the gesture's mode
  // (add vs remove) from the item it started on; `moved` distinguishes a sweep
  // from a plain click so the trailing click isn't double-counted.
  const sweepRef = useRef<{ startIndex: number; select: boolean; moved: boolean } | null>(null);
  const suppressCheckboxClickRef = useRef(false);

  const reloadCounts = useCallback(async () => {
    const [list, freq] = await Promise.all([folderCounts(), frequentCount()]);
    setCounts(Object.fromEntries(list));
    setFreqCount(freq);
  }, []);

  const reloadFolders = useCallback(async () => {
    setFolders(await listFolders());
  }, []);

  // Clustering scans the whole recent history, so — unlike the cheap folder counts — this
  // is not run on every capture. It refreshes on open, after a removal, and on a slow
  // timer while items keep arriving.
  const reloadDupCount = useCallback(async () => {
    setDupCount(await duplicateCount());
  }, []);

  const reloadSnippetCount = useCallback(async () => {
    setSnipCount(await snippetCount());
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

  // "Paste directly" preference: after copy-and-hide, auto-send Ctrl+V.
  useEffect(() => {
    getSettingStr("auto_paste").then((v) => setAutoPaste(v === "1"));
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

  useEffect(() => {
    reloadSnippetCount();
  }, [reloadSnippetCount]);

  useEffect(() => {
    reloadDupCount();
    let timer: number | null = null;
    const un = onItemAdded(() => {
      // Coalesce a burst of captures into one scan.
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(reloadDupCount, 5000);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      un.then((f) => f());
    };
  }, [reloadDupCount]);

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
    setSearchResults(await (fuzzy ? fuzzySearch(q) : search(q)));
  }, [debouncedQuery, fuzzy]);

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
    if (f === "similar") setDupRefresh((n) => n + 1);
    if (f === "snippets") setSnipRefresh((n) => n + 1);
  }, [clearSearch]);

  // Removals made inside the Similar view feed the app's standard undo toast, so a
  // bulk cleanup stays recoverable.
  const handleDuplicatesDeleted = useCallback(
    (ids: string[]) => {
      setPendingDeleteIds(ids);
      reload();
      reloadCounts();
      reloadDupCount();
    },
    [reload, reloadCounts, reloadDupCount]
  );

  // Applying a date range replaces the folder/search view with an all-types view of
  // that window (kept mutually exclusive to stay easy to reason about).
  const applyDateRange = useCallback((r: DateRange) => {
    clearSearch();
    setFolder("all");
    setDateRange(r);
  }, [clearSearch]);

  // The Similar view replaces the timeline entirely — it shows clusters, not a
  // chronological list — so a search or a date filter takes precedence over it.
  const isDuplicatesView = folder === "similar" && !isSearching && !dateRange;
  // The Snippets library is likewise not a timeline — authored templates, not history.
  const isSnippetsView = folder === "snippets" && !isSearching && !dateRange;

  // The Links view can group by domain instead of by date.
  const linkGrouping = folder === "link" && groupByDomain && !isSearching && !dateRange;
  const rows = isSearching
    ? toRows(searchResults)
    : linkGrouping
    ? toDomainRows(folderFlatItems)
    : folderRows;
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

  // A deliberate reuse (Copy / row-click) bumped the item's reuse_count in the DB —
  // refresh so the "Used N×" badge, the sidebar Frequent count, and the Frequent
  // ranking reflect it. Copy leaves created_at untouched, so the timeline never jumps.
  const refreshAfterReuse = useCallback(() => {
    reload();
    reloadCounts();
    if (isSearching) runSearch();
  }, [reload, reloadCounts, isSearching, runSearch]);

  const copy = useCallback(async (it: Item) => {
    await copyItem(it.id);
    setCopied(it.id);
    setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1200);
    refreshAfterReuse();
  }, [refreshAfterReuse]);

  const cleanCopy = useCallback(async (it: Item) => {
    await copyItemClean(it.id);
    setCopied(it.id);
    setTimeout(() => setCopied((c) => (c === it.id ? null : c)), 1200);
    refreshAfterReuse();
  }, [refreshAfterReuse]);

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

  // Set/clear an item's self-destruct timer. `minutes` null clears it.
  const setExpiry = useCallback(
    async (it: Item, minutes: number | null) => {
      await setItemExpiry(it.id, minutes == null ? null : Date.now() + minutes * 60_000);
      reload();
      reloadCounts();
      if (isSearching) runSearch();
    },
    [reload, reloadCounts, isSearching, runSearch]
  );

  // "View full value" routes to the code detail view (syntax-highlighted, with
  // Format for JSON/HTML/CSS) when the text is detected as code, else the plain
  // text detail modal.
  const expandText = useCallback((it: Item) => {
    if (it.item_type === "text" && it.content && detectCode(it.content)) setCodeItem(it);
    else setExpandItem(it);
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
      // A click that closes a sweep-select gesture isn't a toggle — swallow it.
      if (suppressCheckboxClickRef.current) {
        suppressCheckboxClickRef.current = false;
        return;
      }
      if (e.shiftKey && anchorIndexRef.current !== null) {
        selectRange(anchorIndexRef.current, index);
        return;
      }
      toggleSelected(it.id);
      anchorIndexRef.current = index;
    },
    [selectRange, toggleSelected]
  );

  // Add (or remove) every item between two flat indices — the sweep primitive.
  const applyRange = useCallback(
    (from: number, to: number, select: boolean) => {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const it = flatItems[i];
          if (!it) continue;
          if (select) next.add(it.id);
          else next.delete(it.id);
        }
        return next;
      });
      anchorIndexRef.current = to;
    },
    [flatItems]
  );

  const endCheckboxSweep = useCallback(() => {
    const s = sweepRef.current;
    sweepRef.current = null;
    // A gesture that actually moved should eat the click that follows pointerup.
    if (s?.moved) suppressCheckboxClickRef.current = true;
  }, []);

  const onCheckboxPointerDown = useCallback(
    (it: Item, index: number, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      // Clear any leftover suppression from a prior drag that ended off a
      // checkbox (its swallowing click never arrived) so this gesture's own
      // click still registers.
      suppressCheckboxClickRef.current = false;
      sweepRef.current = { startIndex: index, select: !selectedIds.has(it.id), moved: false };
      window.addEventListener("pointerup", endCheckboxSweep, { once: true });
    },
    [selectedIds, endCheckboxSweep]
  );

  const onCheckboxPointerEnter = useCallback(
    (index: number) => {
      const s = sweepRef.current;
      if (!s) return;
      if (!s.moved) {
        // First row entered → this is a drag, not a click; seed the start item.
        s.moved = true;
        applyRange(s.startIndex, s.startIndex, s.select);
      }
      applyRange(s.startIndex, index, s.select);
    },
    [applyRange]
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
      // A drag that began in the checkbox column is a sweep-select, not a
      // drag-to-folder — cancel the native drag so the two never collide.
      if (sweepRef.current) {
        e.preventDefault();
        return;
      }
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

  // Selected items in timeline order (flatItems is newest→oldest, top→bottom), used
  // by Multi-Copy-Merge so the merged output follows the visible order.
  const selectedItems = useMemo(
    () => flatItems.filter((it) => selectedIds.has(it.id)),
    [flatItems, selectedIds]
  );
  const mergeableCount = useMemo(
    () =>
      selectedItems.filter((it) => MERGE_TYPES.includes(it.item_type) && it.content != null).length,
    [selectedItems]
  );

  const mergeSelected = useCallback(
    async (separator: string) => {
      const textItems = selectedItems.filter(
        (it) => MERGE_TYPES.includes(it.item_type) && it.content != null
      );
      if (textItems.length < 2) return;
      const merged = textItems.map((it) => it.content ?? "").join(separator);
      const skipped = selectedItems.length - textItems.length;
      await saveTextItem(merged, true);
      clearSelection();
      setQuickMsg(
        `Merged ${textItems.length} items → copied${
          skipped ? ` · ${skipped} image${skipped === 1 ? "" : "s"} skipped` : ""
        } ✓`
      );
      if (quickMsgTimer.current) window.clearTimeout(quickMsgTimer.current);
      quickMsgTimer.current = window.setTimeout(() => setQuickMsg(null), 2200);
    },
    [selectedItems, clearSelection]
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
      refreshAfterReuse();
      await hideWindow();
      // Paste directly into the window that regains focus. Small delay so the OS
      // has refocused the previous app before the synthetic Ctrl+V lands.
      if (autoPaste) window.setTimeout(() => pasteActive().catch(() => {}), 150);
    },
    [refreshAfterReuse, autoPaste]
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
        frequentCount={freqCount}
        duplicateCount={dupCount}
        snippetCount={snipCount}
        selected={folder}
        onSelect={handleSelectFolder}
        folders={folders}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        dropTargetId={dropTargetId}
        folderDropProps={folderDropProps}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="flex items-center gap-1.5 border-b border-border px-2.5 py-2.5 shrink-0 sm:gap-2.5 sm:px-3.5">
          {/* Folders live in the sidebar; below md it collapses to this drawer toggle. */}
          <button
            onClick={() => setSidebarOpen(true)}
            title="Show folders"
            aria-label="Show folders"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-fg-muted hover:border-border-strong hover:text-fg md:hidden"
          >
            <MenuIcon className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 shrink-0 sm:mr-1">
            <Logo className="h-6 w-6 text-accent" />
            <h1 className="hidden text-[15px] font-semibold tracking-tight sm:inline">ClipVault</h1>
          </div>
          <div className="relative min-w-0 flex-1">
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
              placeholder={fuzzy ? "Fuzzy search…" : "Search clipboard…"}
              className="w-full rounded-md border border-border bg-bg-card py-1.5 pl-8 pr-24 text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            {/* Visible way out of a search — same effect as Escape, but keeps the
                caret in the box so the next query can be typed straight away. */}
            {query && (
              <button
                type="button"
                onClick={() => {
                  clearSearch();
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search"
                title="Clear search"
                className="absolute right-[3.7rem] top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg-muted"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setFuzzy((v) => !v)}
              aria-pressed={fuzzy}
              title={fuzzy ? "Fuzzy matching on (typo-tolerant)" : "Fuzzy matching off (exact)"}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
                fuzzy
                  ? "bg-accent/15 text-accent"
                  : "text-fg-faint hover:bg-bg-hover hover:text-fg-muted"
              }`}
            >
              ~fuzzy
            </button>
          </div>
          {!linkGrouping && (
            <DateNavMenu
              entries={dateNav}
              topRowIndex={topRowIndex}
              onJump={scrollToHeaderIndex}
            />
          )}
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
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg lg:px-2.5"
          >
            <PlusIcon className="h-4 w-4" />
            <span className="hidden lg:inline">Add</span>
          </button>
          <button
            onClick={toggle}
            title={privacy ? "Privacy mode on — capture paused" : "Privacy mode off — capturing"}
            aria-pressed={privacy}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors lg:px-2.5 ${
              privacy
                ? "border-accent/50 bg-accent-dim text-fg"
                : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
            }`}
          >
            <ShieldIcon className={`h-4 w-4 ${privacy ? "text-accent" : ""}`} />
            <span className="hidden lg:inline">Privacy</span>
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

        {isSnippetsView ? (
          <Snippets
            onChanged={() => {
              reloadSnippetCount();
              reloadCounts();
            }}
            refreshKey={snipRefresh}
          />
        ) : isDuplicatesView ? (
          <Duplicates onDeleted={handleDuplicatesDeleted} refreshKey={dupRefresh} />
        ) : (
          <>
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

        {!isSearching && !dateRange && folder === "link" && (
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-border shrink-0 text-sm">
            <span className="text-fg-muted">Links</span>
            <button
              onClick={() => setGroupByDomain((v) => !v)}
              aria-pressed={groupByDomain}
              className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                groupByDomain
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border text-fg-muted hover:border-border-strong hover:text-fg"
              }`}
            >
              {groupByDomain ? "Grouped by domain ✓" : "Group by domain"}
            </button>
          </div>
        )}

        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            total={flatItems.length}
            mergeableCount={mergeableCount}
            folders={folders}
            onMerge={mergeSelected}
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
                  onCheckboxPointerDown={(e) => onCheckboxPointerDown(it, flatIndexById.get(it.id) ?? i, e)}
                  onCheckboxPointerEnter={() => onCheckboxPointerEnter(flatIndexById.get(it.id) ?? i)}
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
                  onDelete={() => del(it)}
                  onPin={() => pin(it)}
                  onSetExpiry={(minutes) => setExpiry(it, minutes)}
                  onZoom={() => setZoom(it)}
                  onQr={() => setQrText(it.content ?? "")}
                  onOpenLink={() => it.content && openUrl(it.content)}
                  onExpandText={() => expandText(it)}
                  onStartEdit={() => setEditingId(it.id)}
                  onSaveEdit={(c) => saveEdit(it.id, c)}
                  onCancelEdit={() => setEditingId(null)}
                />
              </div>
            ))}
          </section>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">
        {rows.length > 0 && <ListHeader />}
        <div
          ref={parentRef}
          className="flex-1 overflow-auto px-3 py-3 min-h-0"
          style={{ scrollbarGutter: "stable" }}
        >
          {isEmpty &&
            (!isSearching && !dateRange && folder === "frequent" ? (
              <div className="mx-auto mt-16 max-w-xs text-center">
                <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-bg-card text-accent">
                  <FlameIcon className="h-6 w-6" />
                </div>
                <h2 className="text-sm font-medium text-fg">Nothing reused yet</h2>
                <p className="mt-1.5 text-sm text-fg-muted">
                  Items show up here once you reuse them from ClipVault, ranked by how
                  often. Copy something from your history again and it'll appear.
                </p>
              </div>
            ) : (
              <p className="text-fg-muted">
                {isSearching
                  ? "No results."
                  : dateRange
                  ? "No items in this date range."
                  : "Nothing captured yet — copy something."}
              </p>
            ))}
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
                    <div className="sticky top-0 z-10 flex items-center gap-1 bg-bg py-1">
                      <label
                        title={`Select all in ${row.label}`}
                        className="group/gcb -ml-1.5 grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors hover:bg-bg-hover/60"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select all in ${row.label}`}
                          checked={groupAll}
                          ref={(el) => {
                            if (el) el.indeterminate = groupSome && !groupAll;
                          }}
                          onChange={() => toggleGroup(groupIds)}
                          className="h-4 w-4 cursor-pointer accent-accent transition-transform duration-150 ease-out group-hover/gcb:scale-125"
                        />
                      </label>
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
                        onCheckboxPointerDown={(e) => onCheckboxPointerDown(row.item, flatIndex, e)}
                        onCheckboxPointerEnter={() => onCheckboxPointerEnter(flatIndex)}
                        onDragStart={(e) => handleItemDragStart(row.item, e)}
                        onDragEnd={handleItemDragEnd}
                        dragging={!!draggingIds && draggingIds.includes(row.item.id)}
                        onCopy={() => copy(row.item)}
                        onCleanCopy={() => cleanCopy(row.item)}
                        onDelete={() => del(row.item)}
                        onPin={() => pin(row.item)}
                        onSetExpiry={(minutes) => setExpiry(row.item, minutes)}
                        onZoom={() => setZoom(row.item)}
                        onQr={() => setQrText(row.item.content ?? "")}
                        onOpenLink={() => row.item.content && openUrl(row.item.content)}
                        onExpandText={() => expandText(row.item)}
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
          {!linkGrouping && (
            <DateRail entries={dateNav} topRowIndex={topRowIndex} onJump={scrollToHeaderIndex} />
          )}
        </div>
          </>
        )}
      </div>

      {quickMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border border-border bg-bg-raised text-sm text-fg shadow-lg">
          {quickMsg}
        </div>
      )}

      {settingsOpen && (
        <Settings
          onClose={() => {
            setSettingsOpen(false);
            // The similarity threshold lives in Settings; re-scan in case it moved.
            reloadDupCount();
            setDupRefresh((n) => n + 1);
          }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4 sm:p-6">
          <div className="my-auto w-full max-w-md space-y-3 rounded-xl border border-border bg-bg-raised p-5 shadow-2xl sm:p-6">
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

      <CodeModal item={codeItem} onClose={() => setCodeItem(null)} />

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
            reloadDupCount();
            setDupRefresh((n) => n + 1);
          }
        }}
        onExpire={() => setPendingDeleteIds(null)}
      />
    </div>
  );
}
