import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Item,
  copySnippet,
  createSnippet,
  deleteItem,
  listSnippets,
  previewSnippet,
  updateContent,
} from "../api";
import { CheckIcon, CopyIcon, EditIcon, PlusIcon, SnippetIcon, TrashIcon } from "./Icon";

/** The placeholders `snippets.rs` knows how to expand, with what they turn into. */
const PLACEHOLDERS: { token: string; means: string }[] = [
  { token: "{{date}}", means: "today, YYYY-MM-DD" },
  { token: "{{time}}", means: "now, HH:MM" },
  { token: "{{datetime}}", means: "date and time" },
  { token: "{{year}}", means: "the current year" },
  { token: "{{clipboard}}", means: "what's on the clipboard" },
  { token: "{{uuid}}", means: "a fresh UUID" },
  { token: "{{cursor}}", means: "removed — marks where to type" },
];

/** The editor used for both a new snippet and an existing one, with a live preview of
 *  what the placeholders will turn into. */
function Editor(props: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  saveLabel: string;
}) {
  const [text, setText] = useState(props.initial);
  const [preview, setPreview] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  // Preview is resolved by the backend so it can never disagree with what a real copy
  // would produce.
  useEffect(() => {
    if (!text.includes("{{")) {
      setPreview("");
      return;
    }
    let live = true;
    previewSnippet(text).then((p) => {
      if (live) setPreview(p);
    });
    return () => {
      live = false;
    };
  }, [text]);

  const insert = (token: string) => {
    const area = areaRef.current;
    if (!area) return;
    const at = area.selectionStart;
    setText((t) => t.slice(0, at) + token + t.slice(area.selectionEnd));
    // Put the caret after what was just inserted rather than back at the start.
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(at + token.length, at + token.length);
    });
  };

  return (
    <div className="rounded-lg border border-accent bg-bg-card p-3">
      <textarea
        ref={areaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel();
          // Ctrl+Enter saves; plain Enter has to stay a newline in a template.
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) props.onSave(text);
        }}
        placeholder="Write the template. Use {{date}}, {{clipboard}}, …"
        className="min-h-28 w-full resize-y rounded-md border border-border bg-bg p-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap gap-1">
        {PLACEHOLDERS.map((p) => (
          <button
            key={p.token}
            type="button"
            onClick={() => insert(p.token)}
            title={p.means}
            className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-fg-faint transition-colors hover:border-accent hover:text-fg"
          >
            {p.token}
          </button>
        ))}
      </div>

      {preview && (
        <div className="mt-2.5 rounded-md border border-border bg-bg p-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
            Pastes as
          </div>
          <pre className="whitespace-pre-wrap break-words font-mono text-[13px] text-fg-muted">
            {preview}
          </pre>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] text-fg-faint">Ctrl+Enter saves · Esc cancels</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded border border-border px-3 py-1 text-sm text-fg-muted transition-colors hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => props.onSave(text)}
            disabled={!text.trim()}
            className="rounded border border-accent bg-accent-dim/40 px-3 py-1 text-sm text-fg transition-colors hover:bg-accent-dim disabled:opacity-40"
          >
            {props.saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Snippets library: templates the user wrote, rather than history they copied. */
export default function Snippets(props: {
  onChanged: () => void;
  /** Bump to force a reload after something outside this view changed the library. */
  refreshKey: number;
}) {
  const { onChanged, refreshKey } = props;
  const [snippets, setSnippets] = useState<Item[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSnippets(await listSnippets());
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const save = useCallback(
    async (text: string) => {
      await createSnippet(text.trim());
      setCreating(false);
      await load();
      onChanged();
    },
    [load, onChanged]
  );

  const update = useCallback(
    async (id: string, text: string) => {
      await updateContent(id, text.trim());
      setEditingId(null);
      await load();
      onChanged();
    },
    [load, onChanged]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteItem(id);
      await load();
      onChanged();
    },
    [load, onChanged]
  );

  const copy = useCallback(async (id: string) => {
    await copySnippet(id);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
  }, []);

  const hasAny = useMemo(() => (snippets?.length ?? 0) > 0, [snippets]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
        <span className="font-mono text-[11px] text-fg-muted tnum">
          {snippets?.length ?? 0} {snippets?.length === 1 ? "snippet" : "snippets"}
        </span>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-accent hover:text-fg"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New snippet
        </button>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3.5 py-3.5"
        style={{ scrollbarGutter: "stable" }}
      >
        {creating && (
          <Editor
            initial=""
            saveLabel="Save snippet"
            onSave={save}
            onCancel={() => setCreating(false)}
          />
        )}

        {snippets === null && <p className="text-sm text-fg-muted">Loading…</p>}

        {snippets !== null && !hasAny && !creating && (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-bg-card text-accent">
              <SnippetIcon className="h-6 w-6" />
            </div>
            <h2 className="text-sm font-medium text-fg">No snippets yet</h2>
            <p className="mt-1.5 text-sm text-fg-muted">
              Snippets are text you write once and reuse — a signature, a reply, a command
              you retype. They can fill in the date or the clipboard when you paste them.
            </p>
          </div>
        )}

        {snippets?.map((s) =>
          editingId === s.id ? (
            <Editor
              key={s.id}
              initial={s.content ?? ""}
              saveLabel="Save changes"
              onSave={(text) => update(s.id, text)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div
              key={s.id}
              className="group rounded-lg border border-border bg-bg-card p-3 transition-colors hover:border-border-strong"
            >
              <div className="flex items-start gap-3">
                <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-sm text-fg/90">
                  {s.content}
                </pre>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingId(s.id)}
                    title="Edit snippet"
                    aria-label="Edit snippet"
                    className="grid h-6 w-6 place-items-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg"
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    title="Delete snippet"
                    aria-label="Delete snippet"
                    className="grid h-6 w-6 place-items-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-red-300"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-fg-faint tnum">
                  {s.reuse_count > 0 ? `Used ${s.reuse_count}×` : "Never used"}
                  {s.content?.includes("{{") ? " · has placeholders" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => copy(s.id)}
                  className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-fg-muted transition-colors hover:border-accent hover:text-fg"
                >
                  {copiedId === s.id ? (
                    <>
                      <CheckIcon className="h-3.5 w-3.5 text-accent" />
                      Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
