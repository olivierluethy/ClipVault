import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { FolderDto, Item } from "../api";
import { Popover, MenuItem } from "./Popover";
import { TransformMenu } from "./TransformMenu";
import { FindReplaceMenu } from "./FindReplaceMenu";
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
  WandIcon,
  ReplaceIcon,
  CheckIcon,
  RepeatIcon,
  LockIcon,
  EyeOffIcon,
  ClockIcon,
  SnippetIcon,
  FileIcon,
} from "./Icon";
import { looksSecret } from "../lib/secret";
import { toCssColor, detectColorFormat } from "../lib/color";

const TYPE_CODE: Record<Item["item_type"], string> = {
  text: "TXT",
  link: "URL",
  number: "NUM",
  phone: "TEL",
  color: "HEX",
  image: "IMG",
  gif: "GIF",
  file: "FILE",
};

/** The badge label for an item — for colours this reflects the actual format
 *  (HEX / RGB / HSL / HSV / CMYK) so the original notation stays recognisable. */
function typeCodeFor(item: Item): string {
  if (item.item_type === "color") return detectColorFormat(item.content ?? "") ?? "HEX";
  return TYPE_CODE[item.item_type];
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Compact "time left" until an expiry (epoch ms): "9m", "2h", "expiring…". */
function remainingLabel(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expiring…";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h`;
}

// Auto-delete presets (label → minutes).
const EXPIRY_OPTIONS: { label: string; minutes: number }[] = [
  { label: "5 minutes", minutes: 5 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "24 hours", minutes: 1440 },
];

/** A round icon button for the hover action rail and overflow trigger. */
function IconButton(props: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  innerRef?: React.Ref<HTMLButtonElement>;
  className?: string;
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
        ${props.className ?? ""}
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

type LinkMetadata = { title?: string; favicon_url?: string; image_url?: string };

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
  const [revealed, setRevealed] = useState(false);
  const secret = looksSecret(item.content, item.item_type);

  if (item.item_type === "color") {
    // Render through the canonical parser so formats CSS can't read natively
    // (cmyk, hsv) still show the right swatch; fall back to a checkerboard hint.
    const css = toCssColor(item.content);
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          className="h-5 w-5 shrink-0 rounded-md border border-border-strong"
          style={{ backgroundColor: css ?? "transparent" }}
        />
        <span className="truncate font-mono text-sm text-fg">{item.content}</span>
      </span>
    );
  }
  if (item.item_type === "link") {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {linkMeta?.image_url ? (
          // Rich preview: the page's Open Graph / Twitter-card image as a small
          // thumbnail. If it fails to load we just hide it (no favicon fallback)
          // so a broken image never clutters the row.
          <img
            src={linkMeta.image_url}
            alt=""
            draggable={false}
            className="h-9 w-12 shrink-0 rounded-md border border-border object-cover"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        ) : linkMeta?.favicon_url ? (
          <img
            src={linkMeta.favicon_url}
            alt=""
            draggable={false}
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
  if (item.item_type === "file") {
    const paths = (item.content ?? "").split("\n").filter(Boolean);
    const first = paths[0] ?? "";
    // The file name is what identifies the entry; the directory is context, so it is
    // shown but never allowed to push the name out of view.
    const slash = first.lastIndexOf("/");
    const dir = slash > 0 ? first.slice(0, slash + 1) : "";
    const name = slash > 0 ? first.slice(slash + 1) : first;
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <FileIcon className="h-4 w-4 shrink-0 text-fg-muted" />
        <span className="flex min-w-0 flex-1 items-baseline gap-1 font-mono text-sm">
          <span className="truncate text-fg-faint">{dir}</span>
          <span className="shrink-0 truncate text-fg/90">{name}</span>
        </span>
        {paths.length > 1 && (
          <span className="shrink-0 rounded-full bg-bg-hover/70 px-1.5 py-[1.5px] font-mono text-[10px] leading-none text-fg-muted tnum">
            +{paths.length - 1}
          </span>
        )}
      </span>
    );
  }
  if (item.item_type === "text" || item.item_type === "number" || item.item_type === "phone") {
    if (secret) {
      return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <LockIcon className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg/90">
            {revealed ? item.content : "••••••••••••"}
          </span>
          <button
            title={revealed ? "Hide secret" : "Reveal secret"}
            aria-label={revealed ? "Hide secret" : "Reveal secret"}
            onClick={(e) => {
              e.stopPropagation();
              setRevealed((v) => !v);
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-faint hover:bg-bg-hover hover:text-fg"
          >
            {revealed ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
          </button>
        </span>
      );
    }
    return (
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg/90">{item.content}</span>
    );
  }
  // image / gif — wrap in a flex-1 zone (like the other types) so the right-hand
  // meta/action cluster still docks to the row's right edge, not next to the thumbnail.
  return thumb ? (
    <span className="flex min-w-0 flex-1 items-center">
      <img
        src={convertFileSrc(thumb)}
        alt=""
        draggable={false}
        className="max-h-14 cursor-zoom-in rounded-md border border-border"
        onClick={(e) => {
          e.stopPropagation();
          onZoom();
        }}
      />
    </span>
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
  /** Drag-to-select: pointer gestures scoped to the checkbox column. */
  onCheckboxPointerDown?: (e: React.PointerEvent) => void;
  onCheckboxPointerEnter?: (e: React.PointerEvent) => void;
  onCopy: () => void;
  onCleanCopy: () => void;
  /** Copy back with the stored text/html flavour, keeping the formatting. */
  onCopyRich: () => void;
  /** Move this entry into the Snippets library. */
  onSaveAsSnippet: () => void;
  onDelete: () => void;
  onPin: () => void;
  onSetExpiry: (minutes: number | null) => void;
  onZoom: () => void;
  onQr: () => void;
  onOpenLink: () => void;
  onExpandText: () => void;
  onStartEdit: () => void;
  onSaveEdit: (content: string) => void;
  onCancelEdit: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  dragging?: boolean;
  copied?: boolean;
}) {
  const { item, selected, multiSelected, editing } = props;
  const contentBased =
    item.item_type === "text" ||
    item.item_type === "link" ||
    item.item_type === "number" ||
    item.item_type === "phone" ||
    item.item_type === "color" ||
    item.item_type === "file";
  const canViewFull =
    (item.item_type === "text" ||
      item.item_type === "number" ||
      item.item_type === "phone" ||
      item.item_type === "link" ||
      item.item_type === "file") &&
    !!item.content;
  const [draft, setDraft] = useState(item.content ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [transformMenuOpen, setTransformMenuOpen] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [expiryMenuOpen, setExpiryMenuOpen] = useState(false);
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
      draggable
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      className={`card group relative flex cursor-pointer items-center gap-3 rounded-lg border pl-3 pr-2.5 py-2.5 transition-colors
        ${props.dragging ? "opacity-40" : ""}
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

      {/* Selection target — a generous, forgiving hit zone (the whole left
          column, ≥36px, 44px on touch-narrow rows). The drawn box stays modest
          but grows on hover so it reads as the thing to click. Dragging down the
          column sweep-selects; that gesture is scoped here so it never collides
          with the row's drag-to-folder. */}
      <button
        role="checkbox"
        aria-checked={multiSelected}
        aria-label={multiSelected ? "Deselect item" : "Select item"}
        title="Select — shift-click for a range, drag to sweep"
        draggable={false}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          // Touch pointers are implicitly captured to this button; release so
          // the sweep can register pointerenter on the rows it crosses.
          if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          props.onCheckboxPointerDown?.(e);
        }}
        onPointerEnter={(e) => props.onCheckboxPointerEnter?.(e)}
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleSelect(e);
        }}
        className="card-checkbox group/cb -ml-1 grid h-9 w-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-bg-hover/60"
      >
        <span
          className={`grid h-[16px] w-[16px] place-items-center rounded border transition-all duration-150 ease-out group-hover/cb:scale-[1.28]
            ${
              multiSelected
                ? "border-accent bg-accent text-bg opacity-100 shadow-[0_0_0_3px_rgba(123,97,255,0.16)]"
                : "border-border-strong text-transparent opacity-0 group-hover:opacity-100 group-hover/cb:border-accent focus-visible:opacity-100"
            }`}
        >
          {multiSelected && (
            <span className="animate-pop-check">
              <CheckIcon className="h-3 w-3" />
            </span>
          )}
        </span>
      </button>

      {/* Type code (monospace, quiet). Dropped on tight rows to protect the preview. */}
      <span className="card-typecode w-9 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        {typeCodeFor(item)}
      </span>

      <Preview item={item} onZoom={props.onZoom} />

      {/* Right rail: meta at rest, cross-fading to the action cluster on hover/focus.
          On tight rows (container query) the meta drops and the actions stay
          permanently visible so they're tappable without hover. */}
      <div className="card-actions-zone relative h-7 shrink-0">
        <div className="card-meta absolute inset-y-0 right-0 flex items-center gap-2.5 pr-1 font-mono text-[11px] text-fg-faint transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 tnum">
          <span title="Time captured">{timeLabel(item.created_at)}</span>
          {/* Copy count: how many times this exact content was *captured* off the OS
              clipboard. This is "copied", deliberately kept separate from "used" — capturing
              something never implies you reused it. Shown only when it recurred (>= 2). */}
          {item.copy_count >= 2 && item.reuse_count === 0 && (
            <span
              title={`This exact content was captured ${item.copy_count} times. Copying isn't the same as using — see "Used" once you reuse it from ClipVault.`}
              aria-label={`Copied ${item.copy_count} times`}
              className="shrink-0 tnum text-fg-faint"
            >
              Copied {item.copy_count}×
            </span>
          )}
          {/* Reuse count: how many times the user re-copied this FROM ClipVault — the only
              honest usage signal (pastes into other apps are unobservable, so we never
              imply them). Hidden until reused at least once, since 0 carries no info. */}
          {item.reuse_count >= 1 && (
            <span
              title={`You've reused this ${item.reuse_count} ${item.reuse_count === 1 ? "time" : "times"} from ClipVault`}
              aria-label={`Used ${item.reuse_count} ${item.reuse_count === 1 ? "time" : "times"}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bg-hover/70 py-[1.5px] pl-1.5 pr-2 text-fg-muted"
            >
              <RepeatIcon className="h-3 w-3 text-fg-faint" />
              <span className="tnum leading-none">Used {item.reuse_count}×</span>
            </span>
          )}
          {item.expires_at != null && (
            <span
              title={`Auto-deletes ${new Date(item.expires_at).toLocaleString()}`}
              aria-label={`Auto-deletes in ${remainingLabel(item.expires_at)}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 py-[1.5px] pl-1.5 pr-2 text-amber-300"
            >
              <ClockIcon className="h-3 w-3" />
              <span className="tnum leading-none">{remainingLabel(item.expires_at)}</span>
            </span>
          )}
          {/* Kept formatting. Worth showing, because it changes what the Copy actions
              can do — plain text or the original markup. */}
          {item.html && (
            <span
              title="Copied with formatting — can be pasted back as rich text"
              className="inline-flex shrink-0 items-center rounded-full bg-bg-hover/70 px-1.5 py-[1.5px] text-[10px] uppercase tracking-wider text-fg-muted leading-none"
            >
              rich
            </span>
          )}
          {item.source_app && (
            <span
              title={`Copied from ${item.source_app}`}
              className="card-action-extra max-w-[7rem] truncate text-fg-faint"
            >
              {item.source_app}
            </span>
          )}
          {item.pinned && <PinIcon className="h-3.5 w-3.5 text-accent" />}
        </div>
        <div className="card-actions pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          {item.item_type === "link" && (
            <IconButton title="Open in browser" onClick={props.onOpenLink} className="card-action-extra">
              <ExternalLinkIcon />
            </IconButton>
          )}
          {canViewFull && (
            <IconButton title="View full value" onClick={props.onExpandText} className="card-action-extra">
              <EyeIcon />
            </IconButton>
          )}
          {contentBased && (
            <IconButton title="Edit" onClick={props.onStartEdit} className="card-action-extra">
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
            <span className="card-copy-label">Copied</span>
          </>
        ) : (
          <>
            <CopyIcon className="h-3.5 w-3.5" />
            <span className="card-copy-label">Copy</span>
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
        {/* Open / Edit live inline on wide rows; listed here too so they stay
            reachable on tight rows where the inline actions collapse. */}
        {item.item_type === "link" && (
          <MenuItem icon={<ExternalLinkIcon className="h-4 w-4" />} onClick={() => { props.onOpenLink(); setMoreMenuOpen(false); }}>
            Open in browser
          </MenuItem>
        )}
        {contentBased && (
          <MenuItem icon={<EditIcon className="h-4 w-4" />} onClick={() => { props.onStartEdit(); setMoreMenuOpen(false); }}>
            Edit
          </MenuItem>
        )}
        {contentBased && (
          <MenuItem
            icon={<WandIcon className="h-4 w-4" />}
            onClick={() => {
              setMoreMenuOpen(false);
              setTransformMenuOpen(true);
            }}
          >
            Transform…
          </MenuItem>
        )}
        {contentBased && (
          <MenuItem
            icon={<ReplaceIcon className="h-4 w-4" />}
            onClick={() => {
              setMoreMenuOpen(false);
              setFindReplaceOpen(true);
            }}
          >
            Find &amp; replace…
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
        {item.html && (
          <MenuItem
            icon={<CopyIcon className="h-4 w-4" />}
            onClick={() => {
              props.onCopyRich();
              setMoreMenuOpen(false);
            }}
          >
            Copy with formatting
          </MenuItem>
        )}
        {contentBased && !item.is_snippet && (
          <MenuItem
            icon={<SnippetIcon className="h-4 w-4" />}
            onClick={() => {
              props.onSaveAsSnippet();
              setMoreMenuOpen(false);
            }}
          >
            Save as snippet
          </MenuItem>
        )}
        <MenuItem icon={<PinIcon className="h-4 w-4" />} onClick={() => { props.onPin(); setMoreMenuOpen(false); }}>
          {item.pinned ? "Unpin" : "Pin"}
        </MenuItem>
        <MenuItem
          icon={<ClockIcon className="h-4 w-4" />}
          onClick={() => {
            setMoreMenuOpen(false);
            setExpiryMenuOpen(true);
          }}
        >
          {item.expires_at ? `Auto-delete (${remainingLabel(item.expires_at)})` : "Auto-delete…"}
        </MenuItem>
        <MenuItem icon={<TrashIcon className="h-4 w-4" />} danger onClick={() => { props.onDelete(); setMoreMenuOpen(false); }}>
          Delete
        </MenuItem>
      </Popover>

      <Popover anchorEl={moreBtnRef.current} open={expiryMenuOpen} onClose={() => setExpiryMenuOpen(false)} width={200}>
        <div className="px-2.5 pb-1 pt-1 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
          Self-destruct in
        </div>
        {EXPIRY_OPTIONS.map((o) => (
          <MenuItem
            key={o.minutes}
            icon={<ClockIcon className="h-4 w-4" />}
            onClick={() => {
              props.onSetExpiry(o.minutes);
              setExpiryMenuOpen(false);
            }}
          >
            {o.label}
          </MenuItem>
        ))}
        {item.expires_at != null && (
          <MenuItem
            icon={<CheckIcon className="h-4 w-4" />}
            onClick={() => {
              props.onSetExpiry(null);
              setExpiryMenuOpen(false);
            }}
          >
            Keep forever (cancel)
          </MenuItem>
        )}
      </Popover>

      {contentBased && (
        <TransformMenu
          anchorEl={moreBtnRef.current}
          open={transformMenuOpen}
          onClose={() => setTransformMenuOpen(false)}
          content={item.content ?? ""}
          item={item}
          onCleanCopy={props.onCleanCopy}
        />
      )}
      {contentBased && (
        <FindReplaceMenu
          anchorEl={moreBtnRef.current}
          open={findReplaceOpen}
          onClose={() => setFindReplaceOpen(false)}
          content={item.content ?? ""}
        />
      )}
    </div>
  );
}
