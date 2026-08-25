/**
 * Canonical colour model for ClipVault (issue #14).
 *
 * Every supported colour literal — hex (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`),
 * `rgb()/rgba()`, `hsl()/hsla()`, `hsv()/hsb()`, and `cmyk()` — is parsed into one
 * normalised RGBA form. From there we can render a real swatch (via a CSS colour the
 * browser always understands) and convert freely between formats, while the stored
 * value keeps its original text so the format is never lost.
 *
 * The Rust classifier (`classifier.rs`) decides *whether* a string is a colour; this
 * module decides *what colour* it is on the frontend.
 */

export type RGBA = { r: number; g: number; b: number; a: number };
export type ColorFormat = "HEX" | "RGB" | "HSL" | "HSV" | "CMYK";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const clamp255 = (n: number) => clamp(Math.round(n), 0, 255);

// ─── Parsing ──────────────────────────────────────────────────────────────────

/** Parse any supported colour string into normalised 0–255 RGBA, or null. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();

  // Hex: 3, 4, 6, or 8 digits.
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    const dup = (c: string) => parseInt(c + c, 16);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: dup(hex[0]),
        g: dup(hex[1]),
        b: dup(hex[2]),
        a: hex.length === 4 ? dup(hex[3]) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  // Functional: name(args)
  const fn = s.match(/^([a-z]+)\(([^)]+)\)$/);
  if (!fn) return null;
  const name = fn[1];
  const nums = fn[2]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map((p) => parseFloat(p.replace("%", "").replace("deg", "")));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const alpha = (i: number) => (nums.length > i ? clamp(nums[i], 0, 1) : 1);

  switch (name) {
    case "rgb":
    case "rgba":
      if (nums.length < 3) return null;
      return { r: clamp255(nums[0]), g: clamp255(nums[1]), b: clamp255(nums[2]), a: alpha(3) };
    case "hsl":
    case "hsla": {
      if (nums.length < 3) return null;
      const [r, g, b] = hslToRgb(nums[0], nums[1], nums[2]);
      return { r, g, b, a: alpha(3) };
    }
    case "hsv":
    case "hsb":
    case "hsva":
    case "hsba": {
      if (nums.length < 3) return null;
      const [r, g, b] = hsvToRgb(nums[0], nums[1], nums[2]);
      return { r, g, b, a: alpha(3) };
    }
    case "cmyk": {
      if (nums.length < 4) return null;
      const [r, g, b] = cmykToRgb(nums[0], nums[1], nums[2], nums[3]);
      return { r, g, b, a: 1 };
    }
    default:
      return null;
  }
}

/** The format a colour string is written in (for the type badge), or null. */
export function detectColorFormat(input: string): ColorFormat | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) return "HEX";
  const fn = s.match(/^([a-z]+)\(/);
  if (!fn) return null;
  switch (fn[1]) {
    case "rgb":
    case "rgba":
      return "RGB";
    case "hsl":
    case "hsla":
      return "HSL";
    case "hsv":
    case "hsb":
    case "hsva":
    case "hsba":
      return "HSV";
    case "cmyk":
      return "CMYK";
    default:
      return null;
  }
}

/** A CSS colour string the browser can always render as a swatch, or null. */
export function toCssColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const c = parseColor(input);
  if (!c) return null;
  return c.a >= 1 ? `rgb(${c.r}, ${c.g}, ${c.b})` : `rgba(${c.r}, ${c.g}, ${c.b}, ${round(c.a, 2)})`;
}

// ─── Conversions between colour spaces (all take/return 0–255 RGB) ──────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hueSextant(h, c, x);
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  v = clamp(v, 0, 100) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hueSextant(h, c, x);
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)];
}

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  [c, m, y, k] = [c, m, y, k].map((n) => clamp(n, 0, 100) / 100) as [number, number, number, number];
  return [
    clamp255(255 * (1 - c) * (1 - k)),
    clamp255(255 * (1 - m) * (1 - k)),
    clamp255(255 * (1 - y) * (1 - k)),
  ];
}

/** Which RGB sextant a hue falls into (shared by HSL and HSV). */
function hueSextant(h: number, c: number, x: number): [number, number, number] {
  if (h < 60) return [c, x, 0];
  if (h < 120) return [x, c, 0];
  if (h < 180) return [0, c, x];
  if (h < 240) return [0, x, c];
  if (h < 300) return [x, 0, c];
  return [c, 0, x];
}

// ─── Formatting an RGBA back out to each notation ───────────────────────────────

const round = (n: number, dp = 0) => {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
};

export function toHexString({ r, g, b, a }: RGBA): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a >= 1 ? base : base + h(a * 255);
}

export function toRgbString({ r, g, b, a }: RGBA): string {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(a, 2)})`;
}

export function toHslString({ r, g, b, a }: RGBA): string {
  const [h, s, l] = rgbToHsl(r, g, b);
  return a >= 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${round(a, 2)})`;
}

export function toHsvString({ r, g, b }: RGBA): string {
  const [h, s, v] = rgbToHsv(r, g, b);
  return `hsv(${h}, ${s}%, ${v}%)`;
}

export function toCmykString({ r, g, b }: RGBA): string {
  const [c, m, y, k] = rgbToCmyk(r, g, b);
  return `cmyk(${c}%, ${m}%, ${y}%, ${k}%)`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = ((h * 60) % 360 + 360) % 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = ((h * 60) % 360 + 360) % 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [Math.round(h), Math.round(s * 100), Math.round(max * 100)];
}

function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return [0, 0, 0, 100];
  const c = (1 - rn - k) / (1 - k);
  const m = (1 - gn - k) / (1 - k);
  const y = (1 - bn - k) / (1 - k);
  return [Math.round(c * 100), Math.round(m * 100), Math.round(y * 100), Math.round(k * 100)];
}
