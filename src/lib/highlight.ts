/**
 * A locally-bundled highlight.js instance (core + a curated common-language set).
 * Everything ships inside the app bundle — no CDN, no network fetch. Used by the
 * code detail view to render syntax-highlighted code with the app's dark theme.
 */
import hljs from "highlight.js/lib/core";

import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml"; // also used for HTML
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import sql from "highlight.js/lib/languages/sql";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import java from "highlight.js/lib/languages/java";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import php from "highlight.js/lib/languages/php";
import ruby from "highlight.js/lib/languages/ruby";
import ini from "highlight.js/lib/languages/ini";
import dockerfile from "highlight.js/lib/languages/dockerfile";

const LANGUAGES: Record<string, unknown> = {
  json,
  xml,
  css,
  javascript,
  typescript,
  python,
  bash,
  sql,
  yaml,
  markdown,
  java,
  c,
  cpp,
  csharp,
  go,
  rust,
  php,
  ruby,
  ini,
  dockerfile,
};

let registered = false;
function ensureRegistered() {
  if (registered) return;
  for (const [name, lang] of Object.entries(LANGUAGES)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hljs.registerLanguage(name, lang as any);
  }
  hljs.registerAliases(["html", "htm", "svg"], { languageName: "xml" });
  hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
  hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
  hljs.registerAliases(["py"], { languageName: "python" });
  hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
  hljs.registerAliases(["yml"], { languageName: "yaml" });
  hljs.registerAliases(["rs"], { languageName: "rust" });
  hljs.registerAliases(["rb"], { languageName: "ruby" });
  registered = true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Friendly display names for highlight.js language ids. */
const LABELS: Record<string, string> = {
  json: "JSON",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  bash: "Shell",
  sql: "SQL",
  yaml: "YAML",
  markdown: "Markdown",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  go: "Go",
  rust: "Rust",
  php: "PHP",
  ruby: "Ruby",
  ini: "INI",
  dockerfile: "Dockerfile",
};

export function languageLabel(lang: string | null | undefined): string {
  if (!lang) return "Code";
  return LABELS[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

/**
 * Auto-detect the language of `code` across the registered set, returning the guess
 * with its relevance and the margin over the runner-up. Callers use these to decide
 * whether the guess is *confident* enough to show a specific language label — a low
 * relevance or a narrow margin means "not sure", and the caller should fall back to a
 * neutral label rather than assert a wrong one.
 */
export function detectLanguage(code: string): {
  language: string | null;
  relevance: number;
  margin: number;
} {
  ensureRegistered();
  try {
    const r = hljs.highlightAuto(code);
    const top = r.relevance ?? 0;
    const second = r.secondBest?.relevance ?? 0;
    return { language: r.language ?? null, relevance: top, margin: top - second };
  } catch {
    return { language: null, relevance: 0, margin: 0 };
  }
}

/**
 * Highlight `code`. If `lang` is a known language it's used directly; otherwise the
 * language is auto-detected across the registered set. Returns HTML-safe markup
 * (highlight.js escapes the code content) plus the language actually used.
 */
export function highlightCode(
  code: string,
  lang: string | null
): { html: string; language: string } {
  ensureRegistered();
  try {
    if (lang && hljs.getLanguage(lang)) {
      const r = hljs.highlight(code, { language: lang, ignoreIllegals: true });
      return { html: r.value, language: lang };
    }
    const r = hljs.highlightAuto(code);
    return { html: r.value, language: r.language ?? "" };
  } catch {
    // Never let a highlighter hiccup break the view — fall back to plain escaped text.
    return { html: escapeHtml(code), language: lang ?? "" };
  }
}
