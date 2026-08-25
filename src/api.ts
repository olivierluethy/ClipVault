import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Item = {
  id: string;
  item_type: "text" | "link" | "number" | "phone" | "color" | "image" | "gif" | "file";
  content: string | null;
  file_path: string | null;
  preview_path: string | null;
  /** Passive capture-dedup bookkeeping. Not shown as the usage count — see reuse_count. */
  copy_count: number;
  /** Times the user deliberately reused this item from within ClipVault (Copy/row click).
   *  The honest "used" signal; drives the "Used N×" badge and Frequent ranking. */
  reuse_count: number;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  metadata: string | null;
  /** Self-destruct time (epoch ms), or null to keep forever. */
  expires_at: number | null;
  /** Window class of the app this was copied from (X11 only), or null. */
  source_app: string | null;
  /** The text/html flavour the source offered, if any — the entry can be pasted
   *  back with its formatting intact. */
  html: string | null;
  /** Authored template rather than captured history; expands placeholders on copy. */
  is_snippet: boolean;
};

export const listItems = (limit = 100, beforeCreatedAt?: number, beforeId?: string) =>
  invoke<Item[]>("list_items", {
    limit,
    beforeCreatedAt: beforeCreatedAt ?? null,
    beforeId: beforeId ?? null,
  });
export const listPinned = () => invoke<Item[]>("list_pinned");
export const listByType = (typeStr: string, limit = 100, beforeCreatedAt?: number, beforeId?: string) =>
  invoke<Item[]>("list_by_type", {
    typeStr,
    limit,
    beforeCreatedAt: beforeCreatedAt ?? null,
    beforeId: beforeId ?? null,
  });
export const listItemsRange = (
  fromMs: number,
  toMs: number,
  limit = 100,
  beforeCreatedAt?: number,
  beforeId?: string
) =>
  invoke<Item[]>("list_items_range", {
    fromMs,
    toMs,
    limit,
    beforeCreatedAt: beforeCreatedAt ?? null,
    beforeId: beforeId ?? null,
  });
/** Most-*reused* items (reuse_count >= 1), ranked by usage then recency. Top-N, not paged.
 *  "Frequent" is driven by deliberate reuse from within ClipVault, NOT by capture count —
 *  copying something repeatedly never makes it frequent; reusing it does. */
export const listFrequent = (limit = 100) => invoke<Item[]>("list_frequent", { limit });
/** How many items qualify for the Frequent view (reuse_count >= 1). */
export const frequentCount = () => invoke<number>("frequent_count");
export const folderCounts = () => invoke<[string, number][]>("folder_counts");
/** Apps entries were copied from, with counts — most-used first. */
export const listSourceApps = () => invoke<[string, number][]>("list_source_apps");
/** Distinct local days ("YYYY-MM-DD") that contain items, with counts. */
export const itemDayCounts = () => invoke<[string, number][]>("item_day_counts");

// ─── Usage analytics (issue #7) ──────────────────────────────────────────────────

export type UsageOverview = {
  total_uses: number;
  used_items: number;
  unused_items: number;
  active_days: number;
  busiest_day: [string, number] | null;
};
/** Full-history usage snapshot for the analytics dashboard. */
export const usageOverview = () => invoke<UsageOverview>("usage_overview");
/** Usage events grouped by local day — powers the usage calendar/heatmap. */
export const usageDayCounts = () => invoke<[string, number][]>("usage_day_counts");

export type ItemUsage = {
  count: number;
  first_used: number | null;
  last_used: number | null;
  /** Recent usage timestamps (epoch ms), newest first. */
  recent: number[];
};
/** Usage detail for one item: count, first/last use, and recent timestamps. */
export const itemUsage = (itemId: string, recentLimit = 12) =>
  invoke<ItemUsage>("item_usage", { itemId, recentLimit });
/** Live items that have never been reused (the "unused" filter). */
export const listUnused = (limit = 200) => invoke<Item[]>("list_unused", { limit });
export const copyItem = (id: string) => invoke<void>("copy_item", { id });
export const copyItemClean = (id: string) => invoke<void>("copy_item_clean", { id });
/** Place arbitrary (transformed/derived) text on the system clipboard without
 *  creating a history entry. Fast path for Transform / Format actions. */
export const copyText = (text: string) => invoke<void>("copy_text", { text });
/** Store arbitrary text as a new history item; optionally copy it to the clipboard
 *  too. Backs Multi-Copy-Merge and every "Save as new entry" action. */
export const saveTextItem = (text: string, copyToClipboard: boolean) =>
  invoke<void>("save_text_item", { text, copyToClipboard });
/** Copy an entry back with its formatting, using the stored text/html flavour. */
export const copyItemHtml = (id: string) => invoke<void>("copy_item_html", { id });
export const deleteItem = (id: string) => invoke<void>("delete_item", { id });
export const restoreItem = (id: string) => invoke<void>("restore_item", { id });
export const setPinned = (id: string, pinned: boolean) => invoke<void>("set_pinned", { id, pinned });
/** Set/clear an item's self-destruct time (epoch ms; null = never expire). */
export const setItemExpiry = (id: string, expiresAt: number | null) =>
  invoke<void>("set_item_expiry", { id, expiresAt });
export const updateContent = (id: string, content: string) => invoke<void>("update_content", { id, content });
export const getPrivacy = () => invoke<boolean>("get_privacy");
export const setPrivacy = (on: boolean) => invoke<void>("set_privacy", { on });
/** Read the CURRENT clipboard and store it now, even while privacy mode is on.
 *  Resolves true if something was added/bumped, false if the clipboard was empty. */
export const quickAdd = () => invoke<boolean>("quick_add");
export const onItemAdded = (cb: () => void) => listen("item-added", cb);
export const onPrivacyChanged = (cb: (on: boolean) => void) =>
  listen<boolean>("privacy-changed", (e) => cb(e.payload));

export type FolderDto = { id: string; name: string; item_count: number };

export const listFolders = () => invoke<FolderDto[]>("list_folders");
export const createFolder = (name: string) => invoke<string>("create_folder", { name });
export const renameFolder = (id: string, name: string) => invoke<void>("rename_folder", { id, name });
export const deleteFolder = (id: string, deleteItems: boolean) =>
  invoke<void>("delete_folder", { id, deleteItems });
/** Persist a user-chosen folder order; `ids` lists every folder top-to-bottom. */
export const reorderFolders = (ids: string[]) => invoke<void>("reorder_folders", { ids });
export const assignItem = (itemId: string, folderId: string) =>
  invoke<void>("assign_item", { itemId, folderId });
export const unassignItem = (itemId: string, folderId: string) =>
  invoke<void>("unassign_item", { itemId, folderId });
export const foldersForItem = (itemId: string) => invoke<string[]>("folders_for_item", { itemId });
export const listItemsInFolder = (
  folderId: string,
  limit = 100,
  beforeCreatedAt?: number,
  beforeId?: string
) =>
  invoke<Item[]>("list_items_in_folder", {
    folderId,
    limit,
    beforeCreatedAt: beforeCreatedAt ?? null,
    beforeId: beforeId ?? null,
  });
export const search = (query: string, limit = 200) => invoke<Item[]>("search", { query, limit });
/** Typo-tolerant search ranked by Levenshtein distance. "Gtihub" still finds "Github". */
export const fuzzySearch = (query: string, limit = 200) =>
  invoke<Item[]>("fuzzy_search", { query, limit });

// ─── Snippets ──────────────────────────────────────────────────────────────────

export const listSnippets = () => invoke<Item[]>("list_snippets");
export const snippetCount = () => invoke<number>("snippet_count");
export const createSnippet = (content: string) => invoke<string>("create_snippet", { content });
/** Move a captured entry into the snippet library, or send it back to history. */
export const setSnippet = (id: string, isSnippet: boolean) =>
  invoke<void>("set_snippet", { id, isSnippet });
/** Expand a snippet's placeholders and put the result on the clipboard. */
export const copySnippet = (id: string) => invoke<string>("copy_snippet", { id });
/** What a template would expand to right now, without touching the clipboard. */
export const previewSnippet = (template: string) =>
  invoke<string>("preview_snippet", { template });

// ─── Clipboard stack ───────────────────────────────────────────────────────────

export type StackStep = { position: number; total: number; preview: string };

/** Paste the next entry down the stack into the focused window. */
export const stackPasteNext = () => invoke<StackStep | null>("stack_paste_next");
/** Start the next stack run from the most recent entry again. */
export const stackReset = () => invoke<void>("stack_reset");
export const onStackAdvanced = (cb: (s: StackStep) => void) =>
  listen<StackStep>("stack-advanced", (e) => cb(e.payload));

// ─── Quick-paste palette ───────────────────────────────────────────────────────

export const showPalette = () => invoke<void>("show_palette");
export const hidePalette = () => invoke<void>("hide_palette");

// ─── Per-category library windows (issue #5) ─────────────────────────────────────

/** Open (or focus) a standalone window for one library category. */
export const openCategory = (category: string) =>
  invoke<void>("open_category", { category });

// ─── Duplicates ("Similar" view) ───────────────────────────────────────────────

export type DuplicateMember = {
  item: Item;
  /** Closeness to the cluster's keeper, 0..1. Exactly 1 means identical. */
  similarity: number;
  /** Whether this entry may be removed — never true for the keeper or a pinned item. */
  removable: boolean;
};

export type DuplicateCluster = {
  id: string;
  keeper_id: string;
  /** Keeper first, then the rest closest-match-first. */
  members: DuplicateMember[];
};

/** Clusters of identical / near-identical entries, largest cluster first. */
export const duplicateClusters = () => invoke<DuplicateCluster[]>("duplicate_clusters");
/** How many entries the Similar view would offer to remove (the sidebar badge). */
export const duplicateCount = () => invoke<number>("duplicate_count");
/** Similarity two entries must reach to be clustered (0.5–1). */
export const getSimilarityThreshold = () => invoke<number>("get_similarity_threshold");
export const setSimilarityThreshold = (value: number) =>
  invoke<void>("set_similarity_threshold", { value });

// ─── Settings / maintenance / export / QR ──────────────────────────────────────

export const getExcludeSecrets = () => invoke<boolean>("get_exclude_secrets");
export const setExcludeSecrets = (on: boolean) => invoke<void>("set_exclude_secrets", { on });
export const getFetchLinkMetadata = () => invoke<boolean>("get_fetch_link_metadata");
export const setFetchLinkMetadata = (on: boolean) => invoke<void>("set_fetch_link_metadata", { on });

export const getSettingStr = (key: string) => invoke<string | null>("get_setting_str", { key });
export const setSettingStr = (key: string, value: string) =>
  invoke<void>("set_setting_str", { key, value });

export const getAutostart = () => invoke<boolean>("get_autostart");
export const setAutostart = (on: boolean) => invoke<void>("set_autostart", { on });

/** Enable Privacy mode now and auto-disable it after `minutes`. */
export const setPrivacyTimed = (minutes: number) => invoke<void>("set_privacy_timed", { minutes });

export type Stats = { items: number; bytes: number };
export const getStats = () => invoke<Stats>("get_stats");

/** Write a backup now; returns the backup file path. */
export const backupNow = () => invoke<string>("backup_now", { stampMs: Date.now() });

/** Export all items to a JSON file; returns the count written. */
export const exportData = (path: string) => invoke<number>("export_data", { path });
/** Import items from a ClipVault export JSON; returns the count newly inserted. */
export const importData = (path: string) => invoke<number>("import_data", { path });

/** Render an item's text/link as a scannable SVG QR code. */
export const qrSvg = (text: string) => invoke<string>("qr_svg", { text });

/** Open a captured link in the user's default browser. */
export const openUrl = (url: string) => invoke<void>("open_url", { url });

/** Simulate Ctrl+V in the currently-focused window (the "paste directly" workflow). */
export const pasteActive = () => invoke<void>("paste_active");

/** Whether the optional tesseract OCR binary is installed (enables image-text search). */
export const ocrAvailable = () => invoke<boolean>("ocr_available");

/** The global hotkey that opens ClipVault (accelerator string, e.g. "Ctrl+Alt+V"). */
export const getHotkey = () => invoke<string>("get_hotkey");
/** Re-register + persist the global open-hotkey. Rejects if it can't be registered. */
export const setHotkey = (hotkey: string) => invoke<void>("set_hotkey", { hotkey });

/** The global shortcuts, by action. Privacy and Quick Add are unbound by default. */
export type HotkeyAction = "open" | "palette" | "pasteNext" | "privacy" | "quickAdd";
export const getHotkeys = () => invoke<Record<HotkeyAction, string>>("get_hotkeys");
/** Re-register + persist one shortcut. Rejects if it can't be registered. */
export const setActionHotkey = (action: HotkeyAction, hotkey: string) =>
  invoke<void>("set_action_hotkey", { action, hotkey });

/** Hide the main window to the tray (used after Enter-to-copy in the speed workflow). */
export const hideWindow = () => getCurrentWindow().hide();
