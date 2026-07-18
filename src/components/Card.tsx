import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { FolderDto, Item } from "../api";

function FolderMenu(props: {
  folders: FolderDto[];
  onClose: () => void;
  loadMemberships: (itemId: string) => Promise<string[]>;
  onToggleFolder: (folderId: string, checked: boolean) => void;
  onCreateAndAssign: (name: string) => void;
  itemId: string;
}) {
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    props.loadMemberships(props.itemId).then((ids) => {
      if (!cancelled) setMemberIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [props.itemId, props.loadMemberships]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [props.onClose]);

  const handleNewFolder = () => {
    const name = window.prompt("New folder name");
    const trimmed = name?.trim();
    if (trimmed) props.onCreateAndAssign(trimmed);
    props.onClose();
  };

  return (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto rounded border border-border bg-bg-raised shadow-lg p-1"
    >
      {memberIds === null ? (
        <div className="px-2 py-1.5 text-xs text-fg-muted">Loading…</div>
      ) : (
        <>
          {props.folders.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-fg-muted">No folders yet</div>
          )}
          {props.folders.map((f) => {
            const checked = memberIds.includes(f.id);
            return (
              <label
                key={f.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-fg hover:bg-bg-card cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setMemberIds((ids) =>
                      ids
                        ? next
                          ? [...ids, f.id]
                          : ids.filter((id) => id !== f.id)
                        : ids
                    );
                    props.onToggleFolder(f.id, next);
                  }}
                  className="shrink-0"
                />
                <span className="flex-1 truncate">{f.name}</span>
              </label>
            );
          })}
        </>
      )}
      <button
        onClick={handleNewFolder}
        className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-card hover:text-fg"
      >
        <span aria-hidden>＋</span>
        <span>New folder…</span>
      </button>
    </div>
  );
}

type LinkMetadata = { title?: string; favicon_url?: string };

function parseLinkMetadata(metadata: string | null): LinkMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed && typeof parsed === "object") return parsed as LinkMetadata;
    return null;
  } catch {
    return null;
  }
}

function CopyMenu(props: {
  onClose: () => void;
  onCleanCopy: () => void;
  onPlainCopy: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [props.onClose]);

  return (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-full mt-1 z-20 w-44 rounded border border-border bg-bg-raised shadow-lg p-1"
    >
      <button
        onClick={() => {
          props.onCleanCopy();
          props.onClose();
        }}
        className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-fg hover:bg-bg-card text-left"
      >
        Clean copy
      </button>
      <button
        onClick={() => {
          props.onPlainCopy();
          props.onClose();
        }}
        className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm text-fg hover:bg-bg-card text-left"
      >
        Copy as plain text
      </button>
    </div>
  );
}

export function Card(props: {
  item: Item;
  selected: boolean;
  multiSelected: boolean;
  editing: boolean;
  folders: FolderDto[];
  loadMemberships: (itemId: string) => Promise<string[]>;
  onToggleFolder: (folderId: string, checked: boolean) => void;
  onCreateAndAssign: (name: string) => void;
  onBodyClick: (e: React.MouseEvent) => void;
  onCopy: () => void;
  onCleanCopy: () => void;
  onPlainCopy: () => void;
  onDelete: () => void;
  onPin: () => void;
  onZoom: () => void;
  onStartEdit: () => void;
  onSaveEdit: (content: string) => void;
  onCancelEdit: () => void;
}) {
  const { item, selected, multiSelected, editing } = props;
  const thumb = item.preview_path ?? item.file_path;
  const contentBased =
    item.item_type === "text" ||
    item.item_type === "link" ||
    item.item_type === "number" ||
    item.item_type === "color";
  const [draft, setDraft] = useState(item.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const linkMeta = item.item_type === "link" ? parseLinkMetadata(item.metadata) : null;

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
      onClick={props.onBodyClick}
      className={`group relative bg-bg-card border rounded p-3 flex gap-3 items-center cursor-pointer
        ${selected ? "border-accent" : "border-border"}
        ${multiSelected ? "ring-2 ring-accent bg-accent-dim/20" : ""}`}
    >
      {multiSelected && (
        <span
          aria-hidden
          className="absolute -left-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] leading-none text-bg-raised"
        >
          ✓
        </span>
      )}
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
        <span className="flex items-center gap-2 truncate text-sm flex-1 min-w-0">
          {linkMeta?.favicon_url && (
            <img
              src={linkMeta.favicon_url}
              alt=""
              className="w-4 h-4 shrink-0 rounded-sm"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          {linkMeta?.title ? (
            <span className="flex flex-col min-w-0 flex-1">
              <span className="truncate text-fg">{linkMeta.title}</span>
              <span className="truncate text-xs text-fg-muted">{item.content}</span>
            </span>
          ) : (
            <span className="truncate text-accent flex-1">{item.content}</span>
          )}
        </span>
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
          <div className="relative">
            <button
              title="More copy options"
              aria-label="More copy options"
              aria-haspopup="true"
              aria-expanded={copyMenuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setCopyMenuOpen((v) => !v);
              }}
              className={`rounded px-1.5 py-1 text-sm hover:bg-bg-raised ${copyMenuOpen ? "text-accent" : "text-fg-muted"}`}
            >
              ⋯
            </button>
            {copyMenuOpen && (
              <CopyMenu
                onCleanCopy={props.onCleanCopy}
                onPlainCopy={props.onPlainCopy}
                onClose={() => setCopyMenuOpen(false)}
              />
            )}
          </div>
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
          <div className="relative">
            <button
              title="Add to folder"
              aria-label="Add to folder"
              aria-haspopup="true"
              aria-expanded={folderMenuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setFolderMenuOpen((v) => !v);
              }}
              className={`rounded px-1.5 py-1 text-sm hover:bg-bg-raised ${folderMenuOpen ? "text-accent" : "text-fg-muted"}`}
            >
              📁
            </button>
            {folderMenuOpen && (
              <FolderMenu
                itemId={item.id}
                folders={props.folders}
                loadMemberships={props.loadMemberships}
                onToggleFolder={props.onToggleFolder}
                onCreateAndAssign={(name) => {
                  props.onCreateAndAssign(name);
                }}
                onClose={() => setFolderMenuOpen(false)}
              />
            )}
          </div>
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
