/**
 * Pure, non-destructive text transforms used by the per-item "Transform" menu.
 * Each takes a string and returns a transformed string; the caller decides whether
 * to copy the result to the clipboard or save it as a new entry. Nothing here
 * mutates a stored item.
 */

/** Split arbitrary text into word tokens, honoring existing camelCase / ACRONYM
 *  boundaries as well as spaces, hyphens, underscores and other punctuation.
 *  Used by the identifier-style case transforms (camel/snake/kebab). */
function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // fooBar -> foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // HTTPServer -> HTTP Server
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function capitalize(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w;
}

export const toLower = (s: string): string => s.toLowerCase();
export const toUpper = (s: string): string => s.toUpperCase();

/** Capitalize the first letter of each word; preserves the original spacing and
 *  punctuation (unlike the identifier transforms). */
export const toTitle = (s: string): string =>
  s.toLowerCase().replace(/(^|[\s([{"'])(\S)/g, (_, sep, ch) => sep + ch.toUpperCase());

export const toCamel = (s: string): string =>
  words(s)
    .map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w)))
    .join("");

export const toSnake = (s: string): string => words(s).map((w) => w.toLowerCase()).join("_");

export const toKebab = (s: string): string => words(s).map((w) => w.toLowerCase()).join("-");

/** Decode HTML entities via a detached <textarea> (RCDATA: decodes character
 *  references but never executes markup, so it's safe). Called after tags are
 *  already stripped by regex. */
function decodeEntities(s: string): string {
  if (typeof document === "undefined") return s;
  const el = document.createElement("textarea");
  el.innerHTML = s;
  return el.value;
}

/**
 * Strip HTML tags and common Markdown syntax to yield raw, unformatted text.
 * Block-level tags become line breaks so structure survives as plain text; inline
 * formatting, links, images and code fences are unwrapped to their visible text.
 * This is the "plain text" action's real behavior.
 */
export function stripToPlainText(input: string): string {
  let s = input;
  // HTML comments and block tags -> newlines (so paragraphs/lists stay separated).
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(/<\/\s*(p|div|li|tr|h[1-6]|ul|ol|blockquote|section|article)\s*>/gi, "\n");
  // Remaining tags -> gone.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  // Markdown: fenced code, images, links, emphasis, headings, quotes, list markers.
  s = s.replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // ![alt](url) -> alt
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // [text](url) -> text
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1"); // [text][ref] -> text
  s = s.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, ""); // headings/quotes/lists
  s = s.replace(/^\s{0,3}([-*_])( *\1){2,}\s*$/gm, ""); // horizontal rules
  s = s.replace(/(\*\*|__)(.*?)\1/g, "$2"); // bold
  s = s.replace(/(\*|_)(.*?)\1/g, "$2"); // italic
  s = s.replace(/~~(.*?)~~/g, "$1"); // strikethrough
  s = s.replace(/`([^`]+)`/g, "$1"); // inline code

  // Tidy whitespace left behind, without collapsing intentional paragraph breaks.
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export type TransformDef = {
  key: string;
  label: string;
  fn: (s: string) => string;
  /** Short example shown as a hint, e.g. "hello world". */
  hint?: string;
};

/** Case conversions, grouped for the Transform menu. */
export const CASE_TRANSFORMS: TransformDef[] = [
  { key: "lower", label: "lowercase", fn: toLower, hint: "all lowercase" },
  { key: "upper", label: "UPPERCASE", fn: toUpper, hint: "ALL UPPERCASE" },
  { key: "title", label: "Title Case", fn: toTitle, hint: "First Letters Capital" },
  { key: "camel", label: "camelCase", fn: toCamel, hint: "camelCaseWords" },
  { key: "snake", label: "snake_case", fn: toSnake, hint: "snake_case_words" },
  { key: "kebab", label: "kebab-case", fn: toKebab, hint: "kebab-case-words" },
];
