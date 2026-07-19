/**
 * Detect what a captured text item is, conservatively. High-precision checks handle
 * the formats that get special treatment (JSON, HTML/XML, Markdown, CSS); everything
 * else only earns a specific language label from a bundled detector when it's
 * *confident*. When nothing is confident we return null so the caller shows the plain
 * text view — a wrong confident label (e.g. Markdown → "SQL") is worse than none.
 *
 * Priority / tie-break order (structured formats win): JSON → HTML/XML → Markdown →
 * CSS → other language (only at high confidence) → plain text (null).
 */
import * as beautify from "js-beautify";
import { detectLanguage, languageLabel } from "./highlight";

export type CodeInfo = {
  /** highlight.js language id for coloring the Raw (and Formatted) view. */
  hljsLang: string;
  /** Honest display label, e.g. "JSON", "HTML", "Markdown", "CSS", "Python". */
  label: string;
  /** Has a correct Formatted (pretty-print) mode — JSON / HTML / XML / CSS only. */
  formattable: boolean;
  /** Pretty-printer; throws on malformed input (caller shows an inline error). */
  format?: (src: string) => string;
  /** Has a Rendered (Markdown preview) mode. */
  markdown: boolean;
};

// A guess is only trusted as a specific language when it clears both bars, so
// ambiguous prose never gets a confident programming-language label.
const MIN_RELEVANCE = 10;
const MIN_MARGIN = 2;
// Enough distinct Markdown signals to be sure (weighted; several, not one).
const MARKDOWN_THRESHOLD = 3;

function isJson(t: string): boolean {
  const s = t.trim();
  if (!(s.startsWith("{") || s.startsWith("["))) return false;
  try {
    const v = JSON.parse(s);
    return v !== null && typeof v === "object"; // ignore bare scalars
  } catch {
    return false;
  }
}

/** "html", "xml", or null. Requires real tag structure, not a stray `<`. */
function detectMarkup(t: string): "html" | "xml" | null {
  const s = t.trim();
  if (/^<\?xml[\s>]/i.test(s)) return "xml";
  if (/^<!doctype\s+html/i.test(s)) return "html";
  const tags = s.match(/<\/?[a-zA-Z][^>]*>/g);
  if (!tags || tags.length < 2) return null;
  if (
    /<\/?(html|head|body|div|span|p|a|ul|ol|li|table|tr|td|img|h[1-6]|script|style|section|article|nav|header|footer|main|button|input|form|label|select|option|meta|link|title|br|hr)\b/i.test(
      s
    )
  ) {
    return "html";
  }
  if (/^<[a-zA-Z]/.test(s) && /<\/[a-zA-Z]/.test(s)) return "xml";
  return null;
}

/** Weighted count of Markdown-specific signals. Distinctive constructs (headings,
 *  fenced code, tables) weigh more; prose with a single stray `*` won't qualify. */
function markdownScore(t: string): number {
  let score = 0;
  if (/^#{1,6}\s+\S/m.test(t)) score += 2; // ATX heading
  if (/(^|\n)\s{0,3}(```|~~~)/.test(t)) score += 2; // fenced code block
  if (/^\s*\|.+\|\s*$/m.test(t) && /^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/m.test(t)) score += 2; // table
  if (/^\s{0,3}[-*+]\s+\S/m.test(t)) score += 1; // unordered list
  if (/^\s{0,3}\d+\.\s+\S/m.test(t)) score += 1; // ordered list
  if (/\[[^\]]+\]\([^)\s]+\)/.test(t)) score += 1; // link
  if (/!\[[^\]]*\]\([^)\s]+\)/.test(t)) score += 1; // image
  if (/(\*\*|__)[^\s*_][^*_\n]*\1/.test(t)) score += 1; // bold
  if (/^\s{0,3}>\s+\S/m.test(t)) score += 1; // blockquote
  return score;
}

function isCss(t: string): boolean {
  const s = t.trim();
  // A rule block with a `prop: value;` declaration. The trailing `;` distinguishes
  // CSS from a JS object literal (which separates with commas).
  if (!/[^{}]+\{[\s\S]*?\}/.test(s)) return false;
  return /[a-zA-Z-]+\s*:\s*[^;{}]+;/.test(s);
}

/** Structural signals that content is source code at all (gates auto-detection so we
 *  never even guess a language for ordinary prose). */
function looksLikeCode(t: string): boolean {
  const s = t.trim();
  if (s.length < 8 || !/\n/.test(s)) return false;
  const structural = [
    /\{[\s\S]*\}/.test(s),
    /;\s*$/m.test(s),
    /=>|::|->|&&|\|\||===|!==|:=/.test(s),
    /^[ \t]{2,}\S/m.test(s),
    /^\s*(#!|\/\/|\/\*|\*\s|--\s|#\s)/m.test(s),
  ].filter(Boolean).length;
  const keyword =
    /\b(function|const|let|var|def|class|import|export|return|public|private|void|struct|fn|package|require|include|elif|namespace|interface|typedef|println|printf|SELECT|INSERT|UPDATE|CREATE)\b/.test(
      s
    );
  return structural >= 2 || (structural >= 1 && keyword);
}

const HTML_OPTS: beautify.HTMLBeautifyOptions = {
  indent_size: 2,
  wrap_line_length: 0,
  preserve_newlines: true,
  max_preserve_newlines: 2,
};
const CSS_OPTS: beautify.CSSBeautifyOptions = { indent_size: 2 };

/**
 * Classify `text`. Returns null for plain prose / anything we can't confidently type,
 * so the caller shows the plain text detail view instead of a mislabeled code view.
 */
export function detectCode(text: string): CodeInfo | null {
  if (!text || !text.trim()) return null;

  if (isJson(text)) {
    return {
      hljsLang: "json",
      label: "JSON",
      formattable: true,
      format: (s) => JSON.stringify(JSON.parse(s), null, 2),
      markdown: false,
    };
  }

  const markup = detectMarkup(text);
  if (markup) {
    return {
      hljsLang: "xml", // highlight.js highlights HTML with its "xml" grammar
      label: markup === "html" ? "HTML" : "XML",
      formattable: true,
      format: (s) => beautify.html(s, HTML_OPTS),
      markdown: false,
    };
  }

  if (markdownScore(text) >= MARKDOWN_THRESHOLD) {
    return { hljsLang: "markdown", label: "Markdown", formattable: false, markdown: true };
  }

  if (isCss(text)) {
    return {
      hljsLang: "css",
      label: "CSS",
      formattable: true,
      format: (s) => beautify.css(s, CSS_OPTS),
      markdown: false,
    };
  }

  // Other programming languages: only trust a specific label at high confidence.
  if (looksLikeCode(text)) {
    const det = detectLanguage(text);
    if (det.language && det.relevance >= MIN_RELEVANCE && det.margin >= MIN_MARGIN) {
      return {
        hljsLang: det.language,
        label: languageLabel(det.language),
        formattable: false, // never fake-format arbitrary languages
        markdown: false,
      };
    }
  }

  return null; // plain text — caller shows the raw text view
}
