import { Item } from "../api";
import { TransformDef } from "./transforms";
import {
  parseColor,
  toHexString,
  toRgbString,
  toHslString,
  toHsvString,
  toCmykString,
} from "./color";

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
      const rgba = parseColor(content);
      if (!rgba) return [];
      const forms: TransformDef[] = [
        { key: "color-hex", label: "As hex", fn: () => toHexString(rgba), hint: toHexString(rgba) },
        { key: "color-rgb", label: "As rgb()", fn: () => toRgbString(rgba), hint: toRgbString(rgba) },
        { key: "color-hsl", label: "As hsl()", fn: () => toHslString(rgba), hint: toHslString(rgba) },
        { key: "color-hsv", label: "As hsv()", fn: () => toHsvString(rgba), hint: toHsvString(rgba) },
        { key: "color-cmyk", label: "As cmyk()", fn: () => toCmykString(rgba), hint: toCmykString(rgba) },
      ];
      // Drop whichever form equals the value already on screen.
      return forms.filter((a) => a.fn(content) !== content.trim());
    }

    case "phone": {
      const digits = content.replace(/[^\d+]/g, "");
      const actions: TransformDef[] = [];
      if (digits && digits !== content.trim()) {
        actions.push({ key: "phone-compact", label: "Compact", fn: () => digits, hint: digits });
      }
      // A tel: URI is what a dialer/soft-phone expects.
      const tel = `tel:${content.replace(/[^\d+]/g, "")}`;
      actions.push({ key: "phone-tel", label: "As tel: link", fn: () => tel, hint: tel });
      return actions;
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
