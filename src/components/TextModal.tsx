import { useEffect } from "react";

/** Full-screen "show more" view for a long text/link/number entry, with a copy button. */
export function TextModal(props: {
  text: string | null;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  if (props.text === null) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={props.onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 rounded-xl border border-border bg-bg-raised p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-4 text-sm text-fg font-mono">
          {props.text}
        </pre>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => props.onCopy(props.text!)}
            className="rounded border border-accent bg-accent-dim/40 px-3 py-1 text-sm text-fg hover:bg-accent-dim"
          >
            Copy
          </button>
          <button
            onClick={props.onClose}
            className="rounded border border-border px-3 py-1 text-sm text-fg-muted hover:text-fg hover:border-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
