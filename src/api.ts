import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Item = {
  id: string;
  item_type: "text" | "link" | "number" | "color" | "image" | "gif";
  content: string | null;
  file_path: string | null;
  preview_path: string | null;
  copy_count: number;
  pinned: boolean;
  created_at: number;
  updated_at: number;
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
export const folderCounts = () => invoke<[string, number][]>("folder_counts");
export const copyItem = (id: string) => invoke<void>("copy_item", { id });
export const deleteItem = (id: string) => invoke<void>("delete_item", { id });
export const restoreItem = (id: string) => invoke<void>("restore_item", { id });
export const setPinned = (id: string, pinned: boolean) => invoke<void>("set_pinned", { id, pinned });
export const updateContent = (id: string, content: string) => invoke<void>("update_content", { id, content });
export const getPrivacy = () => invoke<boolean>("get_privacy");
export const setPrivacy = (on: boolean) => invoke<void>("set_privacy", { on });
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
