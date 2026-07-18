import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Item = {
  id: string;
  item_type: "text" | "image" | "gif";
  content: string | null;
  file_path: string | null;
  copy_count: number;
  created_at: number;
};

export const listRecent = (limit = 200) => invoke<Item[]>("list_recent_items", { limit });
export const getPrivacy = () => invoke<boolean>("get_privacy");
export const setPrivacy = (on: boolean) => invoke<void>("set_privacy", { on });
export const onItemAdded = (cb: () => void) => listen("item-added", cb);
export const onPrivacyChanged = (cb: (on: boolean) => void) =>
  listen<boolean>("privacy-changed", (e) => cb(e.payload));
