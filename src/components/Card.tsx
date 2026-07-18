import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { FolderDto, Item } from "../api";
import { Popover, MenuItem } from "./Popover";
import {
  CopyIcon,
  PinIcon,
  FolderIcon,
  EditIcon,
  TrashIcon,
  EyeIcon,
  QrIcon,
  ExternalLinkIcon,
  MoreIcon,
  CleanIcon,
  TextIcon,
} from "./Icon";

const TYPE_CODE: Record<Item["item_type"], string> = {
  text: "TXT",
  link: "URL",
  number: "NUM",
  color: "HEX",
  image: "IMG",
  gif: "GIF",
};

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A round icon button for the hover action rail and overflow trigger. */
function IconButton(props: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  innerRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={props.innerRef}
      title={props.title}
      aria-label={props.title}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick(e);
      }}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors
        ${
          props.danger
            ? "text-fg-muted hover:bg-red-500/15 hover:text-red-300"
            : props.active
            ? "bg-bg-hover text-accent"
            : "text-fg-muted hover:bg-bg-hover hover:text-fg"
        }`}
    >
      {props.children}
    </button>
  );
}

function FolderMenu(props: {
  anchorEl: HTMLElement | null;
  open: boolean;
  folders: FolderDto[];
  onClose: () => void;
  loadMemberships: (itemId: string) => Promise<string[]>;
  onToggleFolder: (folderId: string, checked: boolean) => void;
  onCreateAndAssign: (name: string) => void;
  itemId: string;
}) {
  const [memberIds, setMemberIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    setMemberIds(null);
    props.loadMemberships(props.itemId).then((ids) => {
      if (!cancelled) setMemberIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.itemId, props.loadMemberships]);

  const handleNewFolder = () => {
    const name = window.prompt("New folder name");
    const trimmed = name?.trim();
    if (trimmed) props.onCreateAndAssign(trimmed);
    props.onClose();
  };

  return (
    <Popover
      anchorEl={props.anchorEl}
      open={props.open}
      onClose={props.onClose}
      width={224}
      menu={false}
      className="z-[100] max-h-64 overflow-y-auto rounded-lg border border-border bg-bg-raised shadow-2xl shadow-black/50 p-1"
    >
      <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
        Add to folder
      </div>
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
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-fg hover:bg-bg-hover cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setMemberIds((ids) =>
                      ids ? (next ? [...ids, f.id] : ids.filter((id) => id !== f.id)) : ids
                    );
                    props.onToggleFolder(f.id, next);
                  }}
                  className="shrink-0 accent-accent"
                />
                <span className="flex-1 truncate">{f.name}</span>
              </label>
            );
          })}
        </>
      )}
      <button
        onClick={handleNewFolder}
        className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <span aria-hidden className="text-base leading-none">＋</span>
        <span>New folder…</span>
      </button>
    </Popover>
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

/** Type-specific preview that fills the row. */
function Preview({ item, onZoom }: { item: Item; onZoom: () => void }) {
  const thumb = item.preview_path ?? item.file_path;
  const linkMeta = item.item_type === "link" ? parseLinkMetadata(item.metadata) : null;

  if (item.item_type === "color") {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className="h-5 w-5 shrink-0 rounded-md border border-border-strong"
          style={{ backgroundColor: item.content ?? "transparent" }}
        />
        <span className="truncate font-mono text-sm text-fg">{item.content}</span>
      </span>
    );
  }
  if (item.item_type === "link") {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {linkMeta?.favicon_url ? (
          <img
            src={linkMeta.favicon_url}
            alt=""
            className="h-4 w-4 shrink-0 rounded-sm"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        ) : (
          <ExternalLinkIcon className="h-4 w-4 shrink-0 text-accent" />
        )}
        {linkMeta?.title ? (
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm text-fg">{linkMeta.title}</span>
            <span className="truncate font-mono text-xs text-fg-muted">{item.content}</span>
          </span>
        ) : (
          <span className="truncate font-mono text-sm text-accent">{item.content}</span>
        )}
      </span>
    );
  }
  if (item.item_type === "text" || item.item_type === "number") {
    return (
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg/90">{item.content}</span>
    );
  }
  // image / gif
  return thumb ? (
    <img
      src={convertFileSrc(thumb)}
      alt=""
      className="max-h-14 cursor-zoom-in rounded-md border border-border"
      onClick={(e) => {
        e.stopPropagation();
        onZoom();
      }}
    />
  ) : (
    <span className="flex-1 font-mono text-sm text-fg-muted">[image]</span>
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
  onToggleSelect: (e: React.MouseEvent) => void;
  onCopy: () => void;
  onCleanCopy: () => void;
  onPlainCopy: () => void;
  onDelete: () => void;
  onPin: () => void;
  onZoom: () => void;
  onQr: () => void;
  onOpenLink: () => void;
  onExpandText: () => void;
  onStartEdit: () => void;
  onSaveEdit: (content: string) => void;
  onCancelEdit: () => void;
  copied?: boolean;
}) {
  const { item, selected, multiSelected, editing } = props;
  const contentBased =
    item.item_type === "text" ||
    item.item_type === "link" ||
    item.item_type === "number" ||
    item.item_type === "color";
  const canViewFull =
    (item.item_type === "text" || item.item_type === "number" || item.item_type === "link") &&
    !!item.content;
  const [draft, setDraft] = useState(item.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const folderBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(item.content ?? "");
      textareaRef.current?.focus();
      textareaRef.current?.select();
    }
  }, [editing, item.content]);

  if (editing) {
    return (
      <div className="rounded-lg border border-accent bg-bg-card p-3">
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
          className="min-h-24 w-full resize-none rounded-md border border-border bg-bg p-2 font-mono text-sm text-fg focus:border-accent focus:outline-none"
        />
        <span className="mt-1.5 block font-mono text-[11px] text-fg-faint">
          Ctrl+Enter to save · Esc to cancel
        </span>
      </div>
    );
  }

  const spine = selected || multiSelected;

  return (
    <div
      onClick={props.onBodyClick}
      className={`group relative flex cursor-pointer items-center gap-3 rounded-lg border pl-3 pr-2.5 py-2.5 transition-colors
        ${
          multiSelected
            ? "border-accent/40 bg-accent-dim/40"
            : selected
            ? "border-border-strong bg-bg-hover"
            : "border-border bg-bg-card hover:border-border-strong hover:bg-bg-raised"
        }`}
    >
      {/* Accent spine marks the active / selected row (quiet, not a full ring). */}
      {spine && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />
      )}

      {/* Selection checkbox — muted until row hover or checked. */}
      <button
        role="checkbox"
        aria-checked={multiSelected}
        aria-label={multiSelected ? "Deselect item" : "Select item"}
        title="Select"
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleSelect(e);
        }}
        className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded border transition-opacity
          ${
            multiSelected
              ? "border-accent bg-accent text-bg opacity-100"
              : "border-border-strong text-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
      >
        {multiSelected && <span className="animate-pop-check text-[9px] leading-none">✓</span>}
      </button>

      {/* Type code (monospace, quiet). */}
      <span className="w-9 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        {TYPE_CODE[item.item_type]}
      </span>

      <Preview item={item} onZoom={props.onZoom} />

      {/* Right rail: meta at rest, cross-fading to the action cluster on hover/focus. */}
      <div className="relative h-7 w-[164px] shrink-0">
        <div className="absolute inset-y-0 right-0 flex items-center gap-2.5 pr-1 font-mono text-[11px] text-fg-faint transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 tnum">
          <span title="Time captured">{timeLabel(item.created_at)}</span>
          {item.copy_count > 1 && <span title={`Copied ${item.copy_count} times`}>×{item.copy_count}</span>}
          {item.pinned && <PinIcon className="h-3.5 w-3.5 text-accent" />}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          {item.item_type === "link" && (
            <IconButton title="Open in browser" onClick={props.onOpenLink}>
              <ExternalLinkIcon />
            </IconButton>
          )}
          {canViewFull && (
            <IconButton title="View full value" onClick={props.onExpandText}>
              <EyeIcon />
            </IconButton>
          )}
          {contentBased && (
            <IconButton title="Edit" onClick={props.onStartEdit}>
              <EditIcon />
            </IconButton>
          )}
          <IconButton title={item.pinned ? "Unpin" : "Pin"} active={item.pinned} onClick={props.onPin}>
            <PinIcon />
          </IconButton>
          <IconButton
            title="Add to folder"
            active={folderMenuOpen}
            innerRef={folderBtnRef}
            onClick={() => setFolderMenuOpen((v) => !v)}
          >
            <FolderIcon />
          </IconButton>
          <IconButton
            title="More actions"
            active={moreMenuOpen}
            innerRef={moreBtnRef}
            onClick={() => setMoreMenuOpen((v) => !v)}
          >
            <MoreIcon />
          </IconButton>
        </div>
      </div>

      {/* Primary action — always visible, unmistakable. */}
      <button
        title="Copy to clipboard"
        aria-label="Copy to clipboard"
        onClick={(e) => {
          e.stopPropagation();
          props.onCopy();
        }}
        className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors
          ${
            props.copied
              ? "border-accent bg-accent text-bg"
              : "border-accent/50 bg-accent/10 text-accent hover:bg-accent hover:text-bg"
          }`}
      >
        {props.copied ? (
          <>
            <span className="animate-pop-check">
              <CopyIcon className="h-3.5 w-3.5" />
            </span>
            Copied
          </>
        ) : (
          <>
            <CopyIcon className="h-3.5 w-3.5" />
            Copy
          </>
        )}
      </button>

      <FolderMenu
        anchorEl={folderBtnRef.current}
        open={folderMenuOpen}
        itemId={item.id}
        folders={props.folders}
        loadMemberships={props.loadMemberships}
        onToggleFolder={props.onToggleFolder}
        onCreateAndAssign={props.onCreateAndAssign}
        onClose={() => setFolderMenuOpen(false)}
      />
      <Popover anchorEl={moreBtnRef.current} open={moreMenuOpen} onClose={() => setMoreMenuOpen(false)} width={208}>
        {contentBased && (
          <MenuItem icon={<CleanIcon className="h-4 w-4" />} onClick={() => { props.onCleanCopy(); setMoreMenuOpen(false); }}>
            Clean copy
          </MenuItem>
        )}
        {contentBased && (
          <MenuItem icon={<TextIcon className="h-4 w-4" />} onClick={() => { props.onPlainCopy(); setMoreMenuOpen(false); }}>
            Copy as plain text
          </MenuItem>
        )}
        {canViewFull && (
          <MenuItem icon={<EyeIcon className="h-4 w-4" />} onClick={() => { props.onExpandText(); setMoreMenuOpen(false); }}>
            View full value
          </MenuItem>
        )}
        {contentBased && (
          <MenuItem icon={<QrIcon className="h-4 w-4" />} onClick={() => { props.onQr(); setMoreMenuOpen(false); }}>
            Show QR code
          </MenuItem>
        )}
        <MenuItem icon={<PinIcon className="h-4 w-4" />} onClick={() => { props.onPin(); setMoreMenuOpen(false); }}>
          {item.pinned ? "Unpin" : "Pin"}
        </MenuItem>
        <MenuItem icon={<TrashIcon className="h-4 w-4" />} danger onClick={() => { props.onDelete(); setMoreMenuOpen(false); }}>
          Delete
        </MenuItem>
      </Popover>
    </div>
  );
}
