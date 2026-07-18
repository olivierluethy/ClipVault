import { useState } from "react";
import { FolderDto } from "../api";
import {
  LayersIcon,
  TextIcon,
  ExternalLinkIcon,
  HashIcon,
  ImageIcon,
  SwatchIcon,
  FolderIcon,
  FolderPlusIcon,
  EditIcon,
  TrashIcon,
} from "./Icon";

type SysFolder = { id: string; label: string; Icon: (p: { className?: string }) => React.JSX.Element };

const SYSTEM: SysFolder[] = [
  { id: "all", label: "All", Icon: LayersIcon },
  { id: "text", label: "Text", Icon: TextIcon },
  { id: "link", label: "Links", Icon: ExternalLinkIcon },
  { id: "number", label: "Numbers", Icon: HashIcon },
  { id: "image", label: "Images & GIFs", Icon: ImageIcon },
  { id: "color", label: "Colors", Icon: SwatchIcon },
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
  trailing?: React.ReactNode;
  dropProps?: React.HTMLAttributes<HTMLDivElement>;
  dropActive?: boolean;
}) {
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
      <button
        onClick={props.onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left"
      >
        {props.children}
        {props.count !== undefined && (
          <span
            className={`ml-auto font-mono text-[11px] tnum ${
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

function UserFolderRow({
  folder,
  isSelected,
  onSelect,
  onRename,
  onDelete,
  dropProps,
  dropActive,
}: {
  folder: FolderDto;
  isSelected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  dropProps?: React.HTMLAttributes<HTMLDivElement>;
  dropActive?: boolean;
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
    <Row
      selected={isSelected}
      onSelect={onSelect}
      count={folder.item_count}
      dropProps={dropProps}
      dropActive={dropActive}
      trailing={
        <div className="flex items-center pr-1.5 opacity-0 transition-opacity group-hover:opacity-100">
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
      <span className="truncate">{folder.name}</span>
    </Row>
  );
}

export function Sidebar({
  counts,
  selected,
  onSelect,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  dropTargetId,
  folderDropProps,
}: {
  counts: Record<string, number>;
  selected: string;
  onSelect: (id: string) => void;
  folders: FolderDto[];
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string, deleteItems: boolean) => void;
  /** Id of the user folder currently highlighted as a drag drop-target (Task 6). */
  dropTargetId?: string | null;
  /** Factory returning drag drop-handlers for a given user folder id (Task 6). */
  folderDropProps?: (folderId: string) => React.HTMLAttributes<HTMLDivElement>;
}) {
  const handleCreate = () => {
    const name = window.prompt("New folder name");
    const trimmed = name?.trim();
    if (trimmed) onCreateFolder(trimmed);
  };

  const handleDelete = (folder: FolderDto) => {
    const deleteItems = window.confirm(
      `Delete folder "${folder.name}"?\n\nOK = delete folder AND its items\nCancel = delete folder only (keep items)`
    );
    onDeleteFolder(folder.id, deleteItems);
  };

  return (
    <nav className="flex w-[208px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-bg p-2">
      <div className="px-2.5 pb-1.5 pt-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        Library
      </div>
      {SYSTEM.map((f) => {
        const Icon = f.Icon;
        return (
          <Row
            key={f.id}
            selected={selected === f.id}
            onSelect={() => onSelect(f.id)}
            count={countFor(f.id, counts)}
          >
            <Icon className={`h-4 w-4 shrink-0 ${selected === f.id ? "text-accent" : ""}`} />
            <span className="truncate">{f.label}</span>
          </Row>
        );
      })}

      <div className="mt-4 flex items-center justify-between px-2.5 pb-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">Folders</span>
        <button
          onClick={handleCreate}
          title="New folder"
          className="grid h-5 w-5 place-items-center rounded text-fg-muted hover:bg-bg-raised hover:text-fg"
        >
          <FolderPlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {folders.length === 0 && (
        <div className="px-2.5 py-1 text-xs text-fg-faint">Drag items here or press ＋</div>
      )}

      {folders.map((f) => (
        <UserFolderRow
          key={f.id}
          folder={f}
          isSelected={selected === `${USER_FOLDER_PREFIX}${f.id}`}
          onSelect={() => onSelect(`${USER_FOLDER_PREFIX}${f.id}`)}
          onRename={(name) => onRenameFolder(f.id, name)}
          onDelete={() => handleDelete(f)}
          dropProps={folderDropProps?.(f.id)}
          dropActive={dropTargetId === f.id}
        />
      ))}
    </nav>
  );
}
