import { useEffect, useMemo, useRef, useState } from "react";
import { Item, copyText, saveTextItem } from "../api";
import { detectCode } from "../lib/codeDetect";
import { highlightCode, languageLabel } from "../lib/highlight";
import { TransformMenu } from "./TransformMenu";
import { CodeIcon, WandIcon, CheckIcon, CopyIcon, PlusIcon, XIcon } from "./Icon";

/**
 * Detail view for a code item: syntax-highlighted (offline, JetBrains Mono) with a
 * Format action for JSON / HTML-XML / CSS, plus Copy, "Save as new entry", and the
 * shared Transform menu. Formatting is never offered for languages that can't be
 * reformatted correctly, and malformed input surfaces an inline message rather than
 * corrupting or crashing.
 */
export function CodeModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const info = useMemo(() => (item?.content ? detectCode(item.content) : null), [item]);
  const [text, setText] = useState(item?.content ?? "");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<"copy" | "save" | "format" | null>(null);
  const [transformOpen, setTransformOpen] = useState(false);
  const transformBtnRef = useRef<HTMLButtonElement>(null);

  // Reset working state whenever a different item is opened.
  useEffect(() => {
    setText(item?.content ?? "");
    setError(null);
    setFlash(null);
    setTransformOpen(false);
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const highlighted = useMemo(
    () => highlightCode(text, info?.hljsLang ?? null),
    [text, info]
  );

  if (!item || !info) return null;

  const label = info.hljsLang ? info.label : languageLabel(highlighted.language);

  const flashThen = (which: "copy" | "save" | "format") => {
    setFlash(which);
    window.setTimeout(() => setFlash((f) => (f === which ? null : f)), 1100);
  };

  const doFormat = () => {
    if (!info.format) return;
    try {
      setText(info.format(text));
      setError(null);
      flashThen("format");
    } catch (e) {
      setError(
        `Couldn't format — the content isn't valid ${info.label}.` +
          (e instanceof Error && e.message ? ` (${e.message})` : "")
      );
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
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-0.5 font-mono text-xs text-fg-muted">
            <CodeIcon className="h-3.5 w-3.5 text-accent" />
            {label}
          </span>
          {info.formattable ? (
            <button
              onClick={doFormat}
              title={`Pretty-print this ${info.label}`}
              className="rounded-md border border-border px-2.5 py-1 text-sm text-fg-muted hover:border-accent hover:text-fg"
            >
              {flash === "format" ? "Formatted ✓" : "Format"}
            </button>
          ) : (
            <span
              title="Formatting isn't offered for this language — it can't be reformatted reliably."
              className="font-mono text-[11px] text-fg-faint"
            >
              highlight only
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
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
                copyText(text).catch(() => {});
                flashThen("copy");
              }}
              className="flex h-8 items-center gap-1.5 rounded-md border border-accent bg-accent/10 px-2.5 text-sm text-accent hover:bg-accent hover:text-bg"
            >
              {flash === "copy" ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
              {flash === "copy" ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => {
                saveTextItem(text, false).catch(() => {});
                flashThen("save");
              }}
              title="Save as a new entry"
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

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Code body */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <pre className="m-0">
            <code
              className="hljs block font-mono text-[13px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: highlighted.html }}
            />
          </pre>
        </div>
      </div>

      <TransformMenu
        anchorEl={transformBtnRef.current}
        open={transformOpen}
        onClose={() => setTransformOpen(false)}
        content={text}
      />
    </div>
  );
}
