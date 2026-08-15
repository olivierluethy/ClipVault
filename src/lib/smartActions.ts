import { Item } from "../api";
import { TransformDef } from "./transforms";

/**
 * Actions that only make sense for one kind of entry.
 *
 * The classifier already knows a colour from a phone number from a file path, and that
 * knowledge was only being used to pick an icon. These are the conversions you would
 * otherwise leave the app to do: a hex value into `rgb()`, a URL down to its domain, a
 * formatted number back to bare digits, a path down to its filename.
 *
 * Every action is a pure string transform, so they reuse the Transform menu's machinery
 * unchanged — copy the result, or save it as a new entry.
 */

// ─── Colour ─────────────────────────────────────────────────────────────────────

/** Parses `#rgb`, `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)` into 0–255 components. */
function parseColor(input: string): [number, number, number] | null {
  const s = input.trim().toLowerCase();

  const hex = s.startsWith("#") ? s.slice(1) : null;
  if (hex && /^[0-9a-f]{3}$/.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex && /^[0-9a-f]{6}$/.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }

  const fn = s.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return [clamp255(parts[0]), clamp255(parts[1]), clamp255(parts[2])];
    }
  }
  return null;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function toHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function toRgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function toHsl([r, g, b]: [number, number, number]): string {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return `hsl(${Math.round(h)}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)`;
}

// ─── Link ───────────────────────────────────────────────────────────────────────

function urlOf(raw: string): URL | null {
  try {
    return new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
}

// ─── File paths ─────────────────────────────────────────────────────────────────

const firstPath = (content: string) => content.split("\n").filter(Boolean)[0] ?? "";

/** Single-quote a path for a shell, escaping any embedded quote. */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * The actions offered for `item`, or an empty list when its type has nothing special to
 * offer. Actions that cannot apply to this particular value (an unparseable colour, a
 * path with no directory) are left out rather than shown returning the input unchanged.
 */
export function smartActionsFor(item: Item): TransformDef[] {
  const content = item.content ?? "";
  if (!content.trim()) return [];

  switch (item.item_type) {
    case "color": {
      const rgb = parseColor(content);
      if (!rgb) return [];
      const asHex = toHex(rgb);
      const asRgb = toRgb(rgb);
      const asHsl = toHsl(rgb);
      return [
        { key: "color-hex", label: "As hex", fn: () => asHex, hint: asHex },
        { key: "color-rgb", label: "As rgb()", fn: () => asRgb, hint: asRgb },
        { key: "color-hsl", label: "As hsl()", fn: () => asHsl, hint: asHsl },
      ].filter((a) => a.fn() !== content.trim());
    }

    case "link": {
      const url = urlOf(content);
      if (!url) return [];
      const actions: TransformDef[] = [
        {
          key: "link-domain",
          label: "Domain only",
          fn: () => url.hostname.replace(/^www\./i, ""),
          hint: url.hostname.replace(/^www\./i, ""),
        },
      ];
      if (url.search) {
        const bare = `${url.origin}${url.pathname}`.replace(/\/$/, "");
        actions.unshift({
          key: "link-bare",
          label: "Drop the query string",
          fn: () => bare,
          hint: bare,
        });
      }
      return actions;
    }

    case "number": {
      const digits = content.replace(/\D/g, "");
      if (!digits || digits === content.trim()) return [];
      return [
        {
          key: "number-digits",
          label: "Digits only",
          fn: () => digits,
          hint: digits,
        },
      ];
    }

    case "file": {
      const path = firstPath(content);
      if (!path) return [];
      const slash = path.lastIndexOf("/");
      const actions: TransformDef[] = [];
      if (slash > 0) {
        actions.push(
          {
            key: "file-name",
            label: "Filename only",
            fn: () => path.slice(slash + 1),
            hint: path.slice(slash + 1),
          },
          {
            key: "file-dir",
            label: "Folder only",
            fn: () => path.slice(0, slash),
            hint: path.slice(0, slash),
          }
        );
      }
      actions.push({
        key: "file-quoted",
        label: "Quoted for the shell",
        fn: (s) => s.split("\n").filter(Boolean).map(shellQuote).join(" "),
        hint: shellQuote(path),
      });
      return actions;
    }

    default:
      return [];
  }
}
