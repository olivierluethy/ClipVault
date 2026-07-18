import { useState } from "react";
import { FolderDto } from "../api";

type Folder = { id: string; label: string; icon: string };

const FOLDERS: Folder[] = [
  { id: "all", label: "All", icon: "🗂" },
  { id: "text", label: "Text", icon: "📝" },
  { id: "link", label: "Links", icon: "🔗" },
  { id: "number", label: "Numbers", icon: "🔢" },
  { id: "image", label: "Images & GIFs", icon: "🖼" },
  { id: "color", label: "Colors", icon: "🎨" },
];

function countFor(id: string, counts: Record<string, number>): number {
  if (id === "all") return Object.values(counts).reduce((a, b) => a + b, 0);
  if (id === "image") return (counts.image ?? 0) + (counts.gif ?? 0);
  return counts[id] ?? 0;
}

const USER_FOLDER_PREFIX = "user:";

function UserFolderRow({
  folder,
  isSelected,
  onSelect,
  onRename,
  onDelete,
}: {
  folder: FolderDto;
  isSelected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
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
      <div className="flex items-center gap-2 rounded px-2 py-1.5">
        <span aria-hidden>📁</span>
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
          className="flex-1 min-w-0 bg-bg-card border border-border rounded px-1 py-0.5 text-sm text-fg"
        />
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
        isSelected ? "bg-accent-dim text-fg" : "text-fg-muted hover:text-fg"
      }`}
    >
      <button onClick={onSelect} className="flex items-center gap-2 flex-1 min-w-0 text-left">
        <span aria-hidden>📁</span>
        <span className="flex-1 truncate">{folder.name}</span>
        <span className="text-xs text-fg-muted">{folder.item_count}</span>
      </button>
      <button
        onClick={() => setEditing(true)}
        title="Rename folder"
        className="hidden group-hover:inline text-xs text-fg-muted hover:text-fg shrink-0"
      >
        ✏️
      </button>
      <button
        onClick={onDelete}
        title="Delete folder"
        className="hidden group-hover:inline text-xs text-fg-muted hover:text-fg shrink-0"
      >
        🗑
      </button>
    </div>
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
}: {
  counts: Record<string, number>;
  selected: string;
  onSelect: (id: string) => void;
  folders: FolderDto[];
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string, deleteItems: boolean) => void;
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
    <nav className="w-[200px] shrink-0 border-r border-border p-2 flex flex-col gap-1 overflow-y-auto">
      {FOLDERS.map((f) => {
        const isSelected = selected === f.id;
        return (
          <button
            key={f.id}
            onClick={() => onSelect(f.id)}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm text-left ${
              isSelected ? "bg-accent-dim text-fg" : "text-fg-muted hover:text-fg"
            }`}
          >
            <span aria-hidden>{f.icon}</span>
            <span className="flex-1 truncate">{f.label}</span>
            <span className="text-xs text-fg-muted">{countFor(f.id, counts)}</span>
          </button>
        );
      })}

      <div className="mt-4 flex items-center justify-between px-2">
        <span className="text-xs uppercase text-fg-muted">Folders</span>
        <button
          onClick={handleCreate}
          title="New folder"
          className="text-fg-muted hover:text-fg text-sm leading-none px-1"
        >
          ＋
        </button>
      </div>

      {folders.length === 0 && (
        <div className="px-2 py-1 text-xs text-fg-muted">No folders yet</div>
      )}

      {folders.map((f) => (
        <UserFolderRow
          key={f.id}
          folder={f}
          isSelected={selected === `${USER_FOLDER_PREFIX}${f.id}`}
          onSelect={() => onSelect(`${USER_FOLDER_PREFIX}${f.id}`)}
          onRename={(name) => onRenameFolder(f.id, name)}
          onDelete={() => handleDelete(f)}
        />
      ))}
    </nav>
  );
}
