import { HotkeyAction } from "../api";

/**
 * Keyboard-shortcut helpers (issue #8): capture a key combination interactively,
 * turn it into a Tauri accelerator string, detect conflicts, and suggest free
 * alternatives. Kept UI-agnostic so the recorder component stays small.
 */

export type Combo = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** The non-modifier key, normalised to a Tauri accelerator token, or null. */
  key: string | null;
};

export type ActionMeta = {
  action: HotkeyAction;
  label: string;
  description: string;
  /** Optional actions are unbound by default and may be cleared. */
  optional: boolean;
};

/** Every configurable action, in the order shown in the overview. */
export const ACTIONS: ActionMeta[] = [
  { action: "open", label: "Open ClipVault", description: "Show and focus the main window", optional: false },
  { action: "palette", label: "Quick-paste palette", description: "Open the compact search-and-paste palette", optional: false },
  { action: "pasteNext", label: "Paste next (stack)", description: "Paste the next entry down the clipboard stack", optional: false },
  { action: "privacy", label: "Toggle Privacy mode", description: "Pause or resume clipboard capture", optional: true },
  { action: "quickAdd", label: "Quick Add", description: "Capture the current clipboard right now", optional: true },
];

const NAMED_KEYS: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS"]);

/** The non-modifier key of an event as an accelerator token, or null if it's a bare modifier. */
export function mainKeyOf(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const k = e.key;
  if (MODIFIER_KEYS.has(k)) return null;
  if (NAMED_KEYS[k]) return NAMED_KEYS[k];
  if (k.length === 1) return k.toUpperCase();
  // Function keys (F1..F12) and anything else pass through as-is.
  return k;
}

export function comboFromEvent(e: KeyboardEvent | React.KeyboardEvent): Combo {
  return {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    key: mainKeyOf(e),
  };
}

export const hasModifier = (c: Combo): boolean => c.ctrl || c.alt || c.shift || c.meta;

/** The accelerator tokens of a combo (modifiers first, then the key), or [] if incomplete. */
export function comboTokens(c: Combo): string[] {
  if (!c.key) return [];
  const mods: string[] = [];
  if (c.ctrl) mods.push("Ctrl");
  if (c.alt) mods.push("Alt");
  if (c.shift) mods.push("Shift");
  if (c.meta) mods.push("Super");
  return [...mods, c.key];
}

/** A Tauri accelerator string ("Ctrl+Alt+V"), or null if the combo lacks a key. */
export function comboToAccelerator(c: Combo): string | null {
  const t = comboTokens(c);
  return t.length ? t.join("+") : null;
}

/** Canonical form for comparing two accelerators regardless of order/case. */
export function normalizeAccelerator(a: string): string {
  return a
    .split("+")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join("+");
}

export const tokensOf = (accel: string): string[] => accel.split("+").map((s) => s.trim()).filter(Boolean);

// A modest list of combinations commonly claimed by Linux desktop environments, so we
// can warn before the OS silently swallows the binding.
const SYSTEM_SHORTCUTS = [
  "Ctrl+Alt+T",
  "Ctrl+Alt+L",
  "Ctrl+Alt+Delete",
  "Super+D",
  "Super+L",
  "Super+E",
  "Super+A",
  "Alt+Tab",
  "Alt+F2",
  "Alt+F4",
  "Ctrl+Alt+F1",
  "Print",
];

export type Conflict = { kind: "app" | "system"; label: string };

/** Whether `accel` collides with another action's shortcut or a known system one. */
export function findConflict(
  accel: string,
  action: HotkeyAction,
  hotkeys: Record<string, string>
): Conflict | null {
  const norm = normalizeAccelerator(accel);
  for (const meta of ACTIONS) {
    if (meta.action === action) continue;
    const other = hotkeys[meta.action];
    if (other && normalizeAccelerator(other) === norm) {
      return { kind: "app", label: meta.label };
    }
  }
  if (SYSTEM_SHORTCUTS.some((s) => normalizeAccelerator(s) === norm)) {
    return { kind: "system", label: "a common system shortcut" };
  }
  return null;
}

/** A few conflict-free Ctrl+Alt+<letter> combinations to offer when one is taken. */
export function suggestAlternatives(
  action: HotkeyAction,
  hotkeys: Record<string, string>
): string[] {
  const letters = "BNMGHJKYUIOP".split("");
  const out: string[] = [];
  for (const l of letters) {
    const cand = `Ctrl+Alt+${l}`;
    if (!findConflict(cand, action, hotkeys)) out.push(cand);
    if (out.length >= 3) break;
  }
  return out;
}

/** Parse an accelerator string back into a Combo (used for the suggestion chips). */
export function accelToCombo(accel: string): Combo {
  const c: Combo = { ctrl: false, alt: false, shift: false, meta: false, key: null };
  for (const t of tokensOf(accel)) {
    const lt = t.toLowerCase();
    if (lt === "ctrl" || lt === "control") c.ctrl = true;
    else if (lt === "alt" || lt === "option") c.alt = true;
    else if (lt === "shift") c.shift = true;
    else if (lt === "super" || lt === "meta" || lt === "cmd" || lt === "command") c.meta = true;
    else c.key = t;
  }
  return c;
}

/** Display a modifier token with the platform's glyph (⌘/⌥/⌃ on macOS). */
export function displayToken(token: string): string {
  const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  if (!isMac) return token;
  switch (token) {
    case "Super":
      return "⌘";
    case "Alt":
      return "⌥";
    case "Ctrl":
      return "⌃";
    case "Shift":
      return "⇧";
    default:
      return token;
  }
}
