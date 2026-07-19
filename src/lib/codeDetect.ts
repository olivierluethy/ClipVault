/**
 * Detect whether a captured text item is structured code, and — only where it can be
 * done *correctly* — expose a pretty-printer for it. JSON, HTML/XML and CSS get a
 * real formatter; other code (Python, JS, …) is detected only for syntax
 * highlighting (no Format action, so we never ship a naive reformatter that could
 * corrupt code).
 */
import * as beautify from "js-beautify";

export type CodeInfo = {
  /** highlight.js language id to use, or null to auto-detect (generic code). */
  hljsLang: string | null;
  /** Display label, e.g. "JSON", "HTML", "CSS", "Code". */
  label: string;
  /** Whether a correct Format action is available. */
  formattable: boolean;
  /** Pretty-printer; throws on malformed input (caller shows an inline error). */
  format?: (src: string) => string;
};

function isJson(t: string): boolean {
  const s = t.trim();
  if (!(s.startsWith("{") || s.startsWith("["))) return false;
  try {
    const v = JSON.parse(s);
    // Bare scalars (`"123"`, `42`, `true`) parse but aren't "code" worth a code view.
    return v !== null && typeof v === "object";
  } catch {
    return false;
  }
}

/** Returns "html", "xml", or null. Requires real tag structure, not just a stray `<`. */
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
  // Generic well-formed-ish markup with a namespace or closing tags → treat as XML.
  if (/^<[a-zA-Z]/.test(s) && /<\/[a-zA-Z]/.test(s)) return "xml";
  return null;
}

function isCss(t: string): boolean {
  const s = t.trim();
  // At least one rule block containing a `prop: value;` declaration. The trailing
  // semicolon distinguishes CSS from a JS object literal (which uses commas).
  if (!/[^{}]+\{[\s\S]*?\}/.test(s)) return false;
  return /[a-zA-Z-]+\s*:\s*[^;{}]+;/.test(s);
}

/** Heuristic: does this look like source code at all (for highlight-only detection)?
 *  Requires real *structural* signals — bare parentheses or an English word like
 *  "class" won't trip it, so ordinary prose stays out of the code view. */
function looksLikeCode(t: string): boolean {
  const s = t.trim();
  if (s.length < 8 || !/\n/.test(s)) return false;
  const structural = [
    /\{[\s\S]*\}/.test(s), // a brace block
    /;\s*$/m.test(s), // statement-ending semicolons
    /=>|::|->|&&|\|\||===|!==|:=/.test(s), // operators/arrows
    /^[ \t]{2,}\S/m.test(s), // indented block lines
    /^\s*(#!|\/\/|\/\*|\*\s|--\s|#\s)/m.test(s), // comment lines
  ].filter(Boolean).length;
  const keyword =
    /\b(function|const|let|var|def|class|import|export|return|public|private|void|struct|fn|package|require|include|elif|namespace|interface|typedef|println|printf)\b/.test(
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
 * Classify `text`. Returns null for plain prose (so the caller shows the normal text
 * view instead of a code view).
 */
export function detectCode(text: string): CodeInfo | null {
  if (!text || !text.trim()) return null;

  if (isJson(text)) {
    return {
      hljsLang: "json",
      label: "JSON",
      formattable: true,
      format: (s) => JSON.stringify(JSON.parse(s), null, 2),
    };
  }

  const markup = detectMarkup(text);
  if (markup) {
    return {
      hljsLang: "xml", // highlight.js highlights HTML with its "xml" grammar
      label: markup === "html" ? "HTML" : "XML",
      formattable: true,
      format: (s) => beautify.html(s, HTML_OPTS),
    };
  }

  if (isCss(text)) {
    return {
      hljsLang: "css",
      label: "CSS",
      formattable: true,
      format: (s) => beautify.css(s, CSS_OPTS),
    };
  }

  if (looksLikeCode(text)) {
    // Detected as code for highlighting only — deliberately no Format action, since
    // we can't reformat arbitrary languages without risking corruption.
    return { hljsLang: null, label: "Code", formattable: false };
  }

  return null;
}
