import { useEffect, useMemo, useRef, useState } from "react";
import { Item, copyText, saveTextItem, openUrl } from "../api";
import { detectCode } from "../lib/codeDetect";
import { highlightCode } from "../lib/highlight";
import { renderMarkdown } from "../lib/markdown";
import { TransformMenu } from "./TransformMenu";
import { CodeIcon, WandIcon, CheckIcon, CopyIcon, PlusIcon, XIcon } from "./Icon";

type ViewMode = "raw" | "formatted" | "rendered";

const MODE_LABEL: Record<ViewMode, string> = {
  raw: "Raw",
  formatted: "Formatted",
  rendered: "Rendered",
};

/**
 * Detail view for a detected code / structured / Markdown item. Always offers a Raw
 * view (exact stored source, syntax-highlighted — coloring only, never altering the
 * content), plus a Rendered view for Markdown or a Formatted view for JSON/HTML/XML/
 * CSS. Copy / "Save as new" always act on the representation matching the current
 * mode; in Rendered mode the preview is view-only and Copy grabs the raw Markdown
 * source (with a separate, clearly-labeled "Copy as HTML"). All offline & sanitized.
 */
export function CodeModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const info = useMemo(() => (item?.content ? detectCode(item.content) : null), [item]);
  const raw = item?.content ?? "";

  const modes = useMemo<ViewMode[]>(() => {
    if (!info) return ["raw"];
    const m: ViewMode[] = [];
    if (info.markdown) m.push("rendered");
    else if (info.formattable) m.push("formatted");
    m.push("raw");
    return m;
  }, [info]);

  const [mode, setMode] = useState<ViewMode>(modes[0]);
  const [flash, setFlash] = useState<"copy" | "save" | "html" | null>(null);
  const [transformOpen, setTransformOpen] = useState(false);
  const transformBtnRef = useRef<HTMLButtonElement>(null);

  // Open in the most-useful default mode whenever a new item is shown.
  useEffect(() => {
    setMode(modes[0]);
    setFlash(null);
    setTransformOpen(false);
  }, [item, modes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Pretty-printed source (JSON/HTML/XML/CSS). Malformed input is reported, not thrown.
  const formatted = useMemo<{ ok: boolean; value: string; error?: string }>(() => {
    if (!info?.formattable || !info.format) return { ok: true, value: raw };
    try {
      return { ok: true, value: info.format(raw) };
    } catch (e) {
      return {
        ok: false,
        value: raw,
        error:
          `Couldn't format — the content isn't valid ${info.label}.` +
          (e instanceof Error && e.message ? ` (${e.message})` : ""),
      };
    }
  }, [raw, info]);

  const renderedHtml = useMemo(
    () => (info?.markdown ? renderMarkdown(raw) : ""),
    [raw, info]
  );

  // The exact text shown/acted-on for the text-based modes (rendered → raw source).
  const sourceText = mode === "formatted" ? formatted.value : raw;
  const highlighted = useMemo(
    () => highlightCode(sourceText, info?.hljsLang ?? null),
    [sourceText, info]
  );

  if (!item || !info) return null;

  const flashThen = (which: "copy" | "save" | "html") => {
    setFlash(which);
    window.setTimeout(() => setFlash((f) => (f === which ? null : f)), 1100);
  };

  const copyLabel = mode === "rendered" ? "Copy source" : "Copy";
  const saveTitle =
    mode === "rendered"
      ? "Save the raw Markdown source as a new entry"
      : mode === "formatted"
      ? "Save the formatted text as a new entry"
      : "Save the raw source as a new entry";

  // Open real links from the rendered preview in the external browser rather than
  // navigating the app's webview.
  const onRenderedClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (href && /^https?:\/\//i.test(href)) {
      e.preventDefault();
      openUrl(href).catch(() => {});
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-bg-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          <span className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-0.5 font-mono text-xs text-fg-muted">
            <CodeIcon className="h-3.5 w-3.5 text-accent" />
            {info.label}
          </span>

          {modes.length > 1 && (
            <div className="flex rounded-md border border-border bg-bg p-0.5">
              {modes.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-accent/15 text-accent"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {mode === "rendered" && (
              <button
                onClick={() => {
                  copyText(renderedHtml).catch(() => {});
                  flashThen("html");
                }}
                title="Copy the rendered output as HTML"
                className="rounded-md border border-border px-2.5 py-1 text-sm text-fg-muted hover:border-accent hover:text-fg"
              >
                {flash === "html" ? "Copied ✓" : "Copy as HTML"}
              </button>
            )}
            <button
              ref={transformBtnRef}
              onClick={() => setTransformOpen((v) => !v)}
              title="Transform text"
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-fg-muted hover:border-accent hover:text-fg"
            >
              <WandIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                copyText(sourceText).catch(() => {});
                flashThen("copy");
              }}
              title={mode === "rendered" ? "Copy the raw Markdown source" : "Copy to clipboard"}
              className="flex h-8 items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-2.5 text-sm text-accent hover:bg-accent hover:text-bg"
            >
              {flash === "copy" ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{flash === "copy" ? "Copied" : copyLabel}</span>
            </button>
            <button
              onClick={() => {
                saveTextItem(sourceText, false).catch(() => {});
                flashThen("save");
              }}
              title={saveTitle}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm text-fg-muted hover:border-accent hover:text-fg"
            >
              {flash === "save" ? <CheckIcon className="h-4 w-4 text-accent" /> : <PlusIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{flash === "save" ? "Saved" : "Save as new"}</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-fg-muted hover:border-accent hover:text-fg"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {mode === "formatted" && !formatted.ok && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {formatted.error}
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {mode === "rendered" ? (
            <div
              className="md-rendered"
              onClick={onRenderedClick}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <pre className="m-0">
              <code
                className="hljs block font-mono text-[13px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: highlighted.html }}
              />
            </pre>
          )}
        </div>
      </div>

      <TransformMenu
        anchorEl={transformBtnRef.current}
        open={transformOpen}
        onClose={() => setTransformOpen(false)}
        content={sourceText}
      />
    </div>
  );
}
