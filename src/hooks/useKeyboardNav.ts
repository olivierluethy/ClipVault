import { useEffect, useState } from "react";
import { Item } from "../api";

export function useKeyboardNav(
  flatItems: Item[],
  actions: {
    copy: (it: Item) => void;
    del: (it: Item) => void;
    pin: (it: Item) => void;
    edit: (it: Item) => void;
    close: () => void;
  }
) {
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;

      if (e.key === "ArrowDown") {
        setSel((s) => Math.min(s + 1, flatItems.length - 1));
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        setSel((s) => Math.max(s - 1, 0));
        e.preventDefault();
      } else if (e.key === "Enter") {
        const it = flatItems[sel];
        if (it) actions.copy(it);
      } else if (e.key === "Delete") {
        const it = flatItems[sel];
        if (it) actions.del(it);
      } else if (e.key === "Escape") {
        actions.close();
      } else if (e.key.toLowerCase() === "p") {
        const it = flatItems[sel];
        if (it) actions.pin(it);
      } else if (e.key.toLowerCase() === "e") {
        const it = flatItems[sel];
        if (it) actions.edit(it);
      } else if (/^[1-9]$/.test(e.key)) {
        const it = flatItems[Number(e.key) - 1];
        if (it) actions.copy(it);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [flatItems, sel, actions]);

  return { sel, setSel };
}
