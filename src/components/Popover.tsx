import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Portal-rendered popover anchored to a trigger element. Renders at the document root
 * so it escapes the virtualized list's `overflow` clipping and always paints above the
 * list. Positions below the anchor, flipping up when there isn't room; keeps itself
 * on-screen horizontally; dismisses on outside-click, Esc, scroll, and resize.
 *
 * Children marked `role="menuitem"` become keyboard-navigable (↑/↓ roving focus,
 * Home/End); Enter/Space activate natively since they're <button>s.
 */
export function Popover(props: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  /** Horizontal edge to align to the anchor. */
  align?: "left" | "right";
  /** Whether to auto-focus the first menu item and enable arrow-key roving. */
  menu?: boolean;
  className?: string;
}) {
  const { anchorEl, open, onClose, width = 224, align = "right", menu = true } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure after paint, then place (and flip up if the menu would overflow below).
  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 0;
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < h + 12 && r.top > spaceBelow;
    let left = align === "right" ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const top = flipUp ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setPos({ top, left });
  }, [open, anchorEl, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && anchorEl && !anchorEl.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchorEl]);

  // Roving focus among menu items.
  useEffect(() => {
    if (!open || !menu) return;
    const el = ref.current;
    if (!el) return;
    const items = () =>
      Array.from(el.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    const onKey = (e: KeyboardEvent) => {
      const list = items();
      if (!list.length) return;
      const cur = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(cur + 1) % list.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(cur - 1 + list.length) % list.length].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        list[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        list[list.length - 1].focus();
      }
    };
    el.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => items()[0]?.focus(), 0);
    return () => {
      el.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open, menu]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      role={menu ? "menu" : undefined}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
      }}
      className={
        props.className ??
        "z-[100] rounded-lg border border-border bg-bg-raised shadow-2xl shadow-black/40 p-1"
      }
    >
      {props.children}
    </div>,
    document.body
  );
}

/** A single action row inside a Popover menu. */
export function MenuItem(props: {
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors
        ${
          props.danger
            ? "text-red-300 hover:bg-red-500/15 focus-visible:bg-red-500/15"
            : "text-fg hover:bg-bg-card focus-visible:bg-bg-card"
        }
        focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-40`}
    >
      {props.icon && <span className="w-4 text-center text-fg-muted">{props.icon}</span>}
      <span className="flex-1 truncate">{props.children}</span>
    </button>
  );
}
