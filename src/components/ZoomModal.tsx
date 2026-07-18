import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { Item } from "../api";

export function ZoomModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!item || !item.file_path) return null;
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <img
        src={convertFileSrc(item.file_path)}
        alt=""
        className="max-h-[90vh] max-w-[90vw] rounded shadow-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
