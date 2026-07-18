import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { Item } from "../api";

export function Card(props: {
  item: Item;
  selected: boolean;
  editing: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onPin: () => void;
  onZoom: () => void;
  onStartEdit: () => void;
  onSaveEdit: (content: string) => void;
  onCancelEdit: () => void;
}) {
  const { item, selected, editing } = props;
  const thumb = item.preview_path ?? item.file_path;
  const contentBased =
    item.item_type === "text" ||
    item.item_type === "link" ||
    item.item_type === "number" ||
    item.item_type === "color";
  const [draft, setDraft] = useState(item.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(item.content ?? "");
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing, item.content]);

  if (editing) {
    return (
      <div
        className="bg-bg-card border border-accent rounded p-3 flex flex-col gap-2"
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              props.onSaveEdit(draft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              props.onCancelEdit();
            }
          }}
          className="bg-bg border border-border rounded p-2 text-sm text-fg resize-none min-h-24 focus:outline-none focus:border-accent"
        />
        <span className="text-xs text-fg-muted">Ctrl+Enter to save · Esc to cancel</span>
      </div>
    );
  }

  return (
    <div
      onClick={props.onCopy}
      className={`group bg-bg-card border rounded p-3 flex gap-3 items-center cursor-pointer
        ${selected ? "border-accent" : "border-border"}`}
    >
      <span className="text-xs uppercase text-accent w-12 shrink-0">{item.item_type}</span>
      {item.item_type === "color" ? (
        <span className="flex items-center gap-2 truncate text-sm flex-1">
          <span
            className="w-4 h-4 rounded border border-border shrink-0"
            style={{ backgroundColor: item.content ?? "transparent" }}
          />
          {item.content}
        </span>
      ) : item.item_type === "link" ? (
        <span className="truncate text-sm flex-1 text-accent">{item.content}</span>
      ) : item.item_type === "text" || item.item_type === "number" ? (
        <span className="truncate text-sm flex-1">{item.content}</span>
      ) : thumb ? (
        <img
          src={convertFileSrc(thumb)}
          alt=""
          className="max-h-16 rounded cursor-zoom-in"
          onClick={(e) => {
            e.stopPropagation();
            props.onZoom();
          }}
        />
      ) : (
        <span className="text-fg-muted text-sm flex-1">[image]</span>
      )}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <span className="text-xs text-fg-muted">×{item.copy_count}</span>
        <div className="flex items-center gap-1">
          {/* Copy is the primary action — always visible and clearly labelled. */}
          <button
            title="Copy to clipboard"
            aria-label="Copy to clipboard"
            onClick={(e) => {
              e.stopPropagation();
              props.onCopy();
            }}
            className="flex items-center gap-1 rounded border border-accent/60 bg-accent-dim/40 px-2 py-1 text-xs text-fg hover:bg-accent-dim"
          >
            <span aria-hidden>⧉</span>
            <span>Copy</span>
          </button>
          <button
            title={item.pinned ? "Unpin" : "Pin"}
            aria-label={item.pinned ? "Unpin" : "Pin"}
            onClick={(e) => {
              e.stopPropagation();
              props.onPin();
            }}
            className={`rounded px-1.5 py-1 text-sm hover:bg-bg-raised ${item.pinned ? "text-accent" : "text-fg-muted"}`}
          >
            📌
          </button>
          {contentBased && (
            <button
              title="Edit"
              aria-label="Edit"
              onClick={(e) => {
                e.stopPropagation();
                props.onStartEdit();
              }}
              className="rounded px-1.5 py-1 text-sm text-fg-muted hover:bg-bg-raised hover:text-accent"
            >
              ✏️
            </button>
          )}
          <button
            title="Delete"
            aria-label="Delete"
            onClick={(e) => {
              e.stopPropagation();
              props.onDelete();
            }}
            className="rounded px-1.5 py-1 text-sm text-fg-muted hover:bg-bg-raised hover:text-red-400"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}
