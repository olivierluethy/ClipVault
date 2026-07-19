/**
 * Offline Markdown rendering for the detail view's "Rendered" mode. Uses the bundled
 * `marked` parser and sanitizes the result with DOMPurify so no active or embedded
 * content (scripts, event handlers, javascript: URLs, iframes, inline styles) can
 * execute. No network is ever touched.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

/** Render Markdown source to sanitized, display-safe HTML. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "textarea", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}
