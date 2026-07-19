import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Item = {
  id: string;
  item_type: "text" | "link" | "number" | "color" | "image" | "gif";
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
/** Most-copied items (copy_count >= 2), ranked by frequency then recency. Top-N, not paged. */
export const listFrequent = (limit = 100) => invoke<Item[]>("list_frequent", { limit });
/** How many items qualify for the Frequent view (copy_count >= 2). */
export const frequentCount = () => invoke<number>("frequent_count");
export const folderCounts = () => invoke<[string, number][]>("folder_counts");
/** Distinct local days ("YYYY-MM-DD") that contain items, with counts. */
export const itemDayCounts = () => invoke<[string, number][]>("item_day_counts");
export const copyItem = (id: string) => invoke<void>("copy_item", { id });
export const copyItemClean = (id: string) => invoke<void>("copy_item_clean", { id });
/** Place arbitrary (transformed/derived) text on the system clipboard without
 *  creating a history entry. Fast path for Transform / Format actions. */
export const copyText = (text: string) => invoke<void>("copy_text", { text });
/** Store arbitrary text as a new history item; optionally copy it to the clipboard
 *  too. Backs Multi-Copy-Merge and every "Save as new entry" action. */
export const saveTextItem = (text: string, copyToClipboard: boolean) =>
  invoke<void>("save_text_item", { text, copyToClipboard });
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
/** Typo-tolerant fuzzy search (fzf-style ranking). "Gthb" still finds "Github". */
export const fuzzySearch = (query: string, limit = 200) =>
  invoke<Item[]>("fuzzy_search", { query, limit });

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

/** The global hotkey that opens ClipVault (accelerator string, e.g. "Ctrl+Alt+V"). */
export const getHotkey = () => invoke<string>("get_hotkey");
/** Re-register + persist the global open-hotkey. Rejects if it can't be registered. */
export const setHotkey = (hotkey: string) => invoke<void>("set_hotkey", { hotkey });

/** Hide the main window to the tray (used after Enter-to-copy in the speed workflow). */
export const hideWindow = () => getCurrentWindow().hide();
