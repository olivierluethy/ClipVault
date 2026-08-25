import { useState } from "react";
import { FolderDto } from "../api";
import { FolderCreateModal, FolderDeleteModal } from "./FolderDialogs";
import {
  LayersIcon,
  TextIcon,
  ExternalLinkIcon,
  HashIcon,
  ImageIcon,
  SwatchIcon,
  PhoneIcon,
  FlameIcon,
  StackIcon,
  FileIcon,
  SnippetIcon,
  FolderIcon,
  FolderPlusIcon,
  EditIcon,
  TrashIcon,
  GripIcon,
} from "./Icon";

/** dataTransfer MIME used when dragging a folder to reorder it (kept distinct from
 *  the clipboard-item drag type so the two gestures never collide on a folder row). */
const FOLDER_DND_TYPE = "application/x-clipvault-folder";

type SysFolder = {
  id: string;
  label: string;
  Icon: (p: { className?: string }) => React.JSX.Element;
  /** Fuller label for the icon-rail tooltip; falls back to `label`. */
  title?: string;
};

const SYSTEM: SysFolder[] = [
  { id: "all", label: "All", Icon: LayersIcon },
  // Smart view: ranked by how often each item was copied (not a type bucket).
  { id: "frequent", label: "Frequent", Icon: FlameIcon, title: "Most frequently copied" },
  // Smart view: entries that duplicate one another, grouped for cleanup.
  { id: "similar", label: "Similar", Icon: StackIcon, title: "Duplicate & near-duplicate entries" },
  { id: "text", label: "Text", Icon: TextIcon },
  { id: "link", label: "Links", Icon: ExternalLinkIcon },
  { id: "number", label: "Numbers", Icon: HashIcon },
  { id: "phone", label: "Phone Numbers", Icon: PhoneIcon, title: "Detected phone numbers" },
  { id: "image", label: "Images & GIFs", Icon: ImageIcon },
  { id: "color", label: "Colors", Icon: SwatchIcon },
  { id: "file", label: "Files", Icon: FileIcon, title: "Files copied in the file manager" },
  // Smart view: authored templates, not captured history.
  { id: "snippets", label: "Snippets", Icon: SnippetIcon, title: "Reusable templates you wrote" },
];

function countFor(id: string, counts: Record<string, number>): number {
  if (id === "all") return Object.values(counts).reduce((a, b) => a + b, 0);
  if (id === "image") return (counts.image ?? 0) + (counts.gif ?? 0);
  return counts[id] ?? 0;
}

const USER_FOLDER_PREFIX = "user:";

/** Shared row shell so system and user folders share exact rhythm and active styling. */
function Row(props: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  count?: number;
  /** Accessible label used for the icon-rail tooltip (hover). */
  title?: string;
  trailing?: React.ReactNode;
  dropProps?: React.HTMLAttributes<HTMLDivElement>;
  dropActive?: boolean;
}) {
  const hasCount = props.count !== undefined;
  return (
    <div
      {...props.dropProps}
      className={`group relative flex items-center rounded-md text-sm transition-colors
        ${
          props.dropActive
            ? "ring-1 ring-accent bg-accent-dim/60"
            : props.selected
            ? "bg-accent-dim text-fg"
            : "text-fg-muted hover:bg-bg-raised hover:text-fg"
        }`}
    >
      {props.selected && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />
      )}
      {/* Icon-rail count badge — replaces the inline count when labels are hidden. */}
      {hasCount && props.count! > 0 && (
        <span className="sb-rail-only pointer-events-none absolute right-1 top-0.5 rounded-full bg-bg-hover px-1 font-mono text-[9px] leading-[14px] tnum text-fg-muted">
          {props.count! > 99 ? "99+" : props.count}
        </span>
      )}
      <button
        onClick={props.onSelect}
        title={props.title}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left md:justify-center lg:justify-start"
      >
        {props.children}
        {hasCount && (
          <span
            className={`sb-full-only ml-auto font-mono text-[11px] tnum ${
              props.selected ? "text-fg-muted" : "text-fg-faint"
            }`}
          >
            {props.count}
          </span>
        )}
      </button>
      {props.trailing}
    </div>
  );
}

type ReorderDrag = {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  /** This folder is the one being dragged. */
  isDragging: boolean;
  /** A dragged folder is hovering over this one — show the drop indicator. */
  isOver: boolean;
};

function UserFolderRow({
  folder,
  isSelected,
  onSelect,
  onRename,
  onDelete,
  dropProps,
  dropActive,
  reorder,
}: {
  folder: FolderDto;
  isSelected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  dropProps?: React.HTMLAttributes<HTMLDivElement>;
  dropActive?: boolean;
  reorder?: ReorderDrag;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);

  const commitRename = () => {
    const trimmed = name.trim();
    setEditing(false);
    if (trimmed && trimmed !== folder.name) onRename(trimmed);
    else setName(folder.name);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5">
        <FolderIcon className="h-4 w-4 shrink-0 text-fg-muted" />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setName(folder.name);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-1.5 py-0.5 text-sm text-fg focus:border-accent focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative ${reorder?.isDragging ? "opacity-40" : ""}`}
      onDragOver={reorder?.onDragOver}
      onDrop={reorder?.onDrop}
    >
      {/* Drop indicator: a bar showing where the dragged folder will land. */}
      {reorder?.isOver && (
        <span className="pointer-events-none absolute -top-0.5 left-1 right-1 z-10 h-0.5 rounded-full bg-accent" />
      )}
      <Row
        selected={isSelected}
        onSelect={onSelect}
        count={folder.item_count}
        title={folder.name}
        dropProps={dropProps}
        dropActive={dropActive}
        trailing={
          <div className="sb-full-only flex items-center pr-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            {/* Drag handle — the only element that starts a reorder drag, so plain
                clicks on the row still select/rename without a stray drag. */}
            <span
              draggable
              onDragStart={reorder?.onDragStart}
              onDragEnd={reorder?.onDragEnd}
              title="Drag to reorder"
              className="grid h-6 w-5 cursor-grab place-items-center text-fg-faint hover:text-fg-muted active:cursor-grabbing"
            >
              <GripIcon className="h-3.5 w-3.5" />
            </span>
            <button
              onClick={() => setEditing(true)}
              title="Rename folder"
              className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              <EditIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              title="Delete folder"
              className="grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-bg-hover hover:text-red-300"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        }
      >
        <FolderIcon className="h-4 w-4 shrink-0" />
        <span className="truncate sb-full-only">{folder.name}</span>
      </Row>
    </div>
  );
}

export function Sidebar({
  counts,
  frequentCount,
  duplicateCount,
  snippetCount,
  selected,
  onSelect,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onReorderFolders,
  dropTargetId,
  folderDropProps,
  open = false,
  onClose,
}: {
  counts: Record<string, number>;
  /** Count for the "Frequent" smart view; kept out of `counts` so "All" doesn't double it. */
  frequentCount: number;
  /** Removable entries the "Similar" smart view found; likewise kept out of `counts`. */
  duplicateCount: number;
  /** How many snippets exist; kept out of `counts` since they aren't captured history. */
  snippetCount: number;
  selected: string;
  onSelect: (id: string) => void;
  folders: FolderDto[];
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string, deleteItems: boolean) => void;
  /** Persist a new top-to-bottom folder order after a drag-reorder. */
  onReorderFolders: (ids: string[]) => void;
  /** Id of the user folder currently highlighted as a drag drop-target (Task 6). */
  dropTargetId?: string | null;
  /** Factory returning drag drop-handlers for a given user folder id (Task 6). */
  folderDropProps?: (folderId: string) => React.HTMLAttributes<HTMLDivElement>;
  /** Below `md` the sidebar is an overlay drawer; `open` controls its visibility. */
  open?: boolean;
  onClose?: () => void;
}) {
  // Styled New-folder dialog (issue #15) replaces the native window.prompt.
  const [createOpen, setCreateOpen] = useState(false);
  // Folder pending a styled delete confirmation (issue #16), or null.
  const [deleteTarget, setDeleteTarget] = useState<FolderDto | null>(null);
  // Drag-to-reorder state: the folder being dragged and the one it's hovering over.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // On narrow layouts the sidebar is a drawer; picking a destination closes it.
  const pick = (id: string) => {
    onSelect(id);
    onClose?.();
  };

  // Move `dragId` to `dropId`'s position and persist the whole order.
  const commitReorder = (dragId: string, dropId: string) => {
    const ids = folders.map((f) => f.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(dropId);
    if (from < 0 || to < 0 || from === to) return;
    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    onReorderFolders(next);
  };

  const reorderFor = (folder: FolderDto): ReorderDrag => ({
    isDragging: dragId === folder.id,
    isOver: dragId !== null && overId === folder.id && dragId !== folder.id,
    onDragStart: (e) => {
      e.dataTransfer.setData(FOLDER_DND_TYPE, folder.id);
      e.dataTransfer.effectAllowed = "move";
      setDragId(folder.id);
    },
    onDragEnd: () => {
      setDragId(null);
      setOverId(null);
    },
    onDragOver: (e) => {
      // Only react to a folder-reorder drag, never a clipboard-item drag.
      if (!e.dataTransfer.types.includes(FOLDER_DND_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverId(folder.id);
    },
    onDrop: (e) => {
      if (!e.dataTransfer.types.includes(FOLDER_DND_TYPE)) return;
      e.preventDefault();
      const from = e.dataTransfer.getData(FOLDER_DND_TYPE);
      if (from) commitReorder(from, folder.id);
      setDragId(null);
      setOverId(null);
    },
  });

  return (
    <>
      {/* Drawer scrim (mobile only). */}
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden ${
          open ? "block animate-fade-in" : "hidden"
        }`}
      />
      <nav
        aria-label="Library and folders"
        className={`fixed inset-y-0 left-0 z-50 flex w-[208px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-bg p-2 transition-transform duration-200
          md:relative md:z-auto md:w-14 md:translate-x-0 md:shadow-none lg:w-[208px]
          ${open ? "translate-x-0 shadow-2xl shadow-black/60" : "-translate-x-full"}`}
      >
        <div className="sb-full-only px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
          Library
        </div>
        {SYSTEM.map((f) => {
          const Icon = f.Icon;
          return (
            <Row
              key={f.id}
              selected={selected === f.id}
              onSelect={() => pick(f.id)}
              count={
                f.id === "frequent"
                  ? frequentCount
                  : f.id === "similar"
                  ? duplicateCount
                  : f.id === "snippets"
                  ? snippetCount
                  : countFor(f.id, counts)
              }
              title={f.title ?? f.label}
            >
              <Icon className={`h-4 w-4 shrink-0 ${selected === f.id ? "text-accent" : ""}`} />
              <span className="truncate sb-full-only">{f.label}</span>
            </Row>
          );
        })}

        {/* Rail divider between the two groups when labels are hidden. */}
        <div className="sb-rail-only mx-2 my-2 h-px bg-border" />

        <div className="mt-4 flex items-center justify-between px-2.5 pb-1 sb-full-only">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Folders</span>
          <button
            onClick={() => setCreateOpen(true)}
            title="New folder"
            className="grid h-5 w-5 place-items-center rounded text-fg-muted hover:bg-bg-raised hover:text-fg"
          >
            <FolderPlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* Rail-mode new-folder affordance (the labelled header above is hidden). */}
        <button
          onClick={() => setCreateOpen(true)}
          title="New folder"
          className="sb-rail-only mx-auto grid h-8 w-8 place-items-center rounded-md text-fg-muted hover:bg-bg-raised hover:text-fg"
        >
          <FolderPlusIcon className="h-4 w-4" />
        </button>

        {folders.length === 0 && (
          <div className="sb-full-only px-2.5 py-1 text-xs text-fg-faint">Drag items here or press ＋</div>
        )}

        {folders.map((f) => (
          <UserFolderRow
            key={f.id}
            folder={f}
            isSelected={selected === `${USER_FOLDER_PREFIX}${f.id}`}
            onSelect={() => pick(`${USER_FOLDER_PREFIX}${f.id}`)}
            onRename={(name) => onRenameFolder(f.id, name)}
            onDelete={() => setDeleteTarget(f)}
            dropProps={folderDropProps?.(f.id)}
            dropActive={dropTargetId === f.id}
            reorder={reorderFor(f)}
          />
        ))}
      </nav>

      <FolderCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={onCreateFolder}
      />
      <FolderDeleteModal
        folder={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(id, deleteItems) => onDeleteFolder(id, deleteItems)}
      />
    </>
  );
}
