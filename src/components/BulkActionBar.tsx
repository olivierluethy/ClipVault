import { useEffect, useRef, useState } from "react";
import { FolderDto } from "../api";

function FolderDropdown(props: {
  folders: FolderDto[];
  onPick: (folderId: string) => void;
  onClose: () => void;
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
      className="absolute left-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto rounded border border-border bg-bg-raised shadow-lg p-1"
    >
      {props.folders.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-fg-muted">No folders yet</div>
      ) : (
        props.folders.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              props.onPick(f.id);
              props.onClose();
            }}
            className="w-full text-left rounded px-2 py-1.5 text-sm text-fg hover:bg-bg-card truncate"
          >
            {f.name}
          </button>
        ))
      )}
    </div>
  );
}

export function BulkActionBar(props: {
  count: number;
  folders: FolderDto[];
  onAddToFolder: (folderId: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);

  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg-raised px-4 py-2 shrink-0">
      <span className="text-sm font-medium text-fg">{props.count} selected</span>
      <div className="relative">
        <button
          onClick={() => setFolderMenuOpen((v) => !v)}
          className="rounded border border-border px-2 py-1 text-sm text-fg hover:bg-bg-card"
        >
          Add to folder ▾
        </button>
        {folderMenuOpen && (
          <FolderDropdown
            folders={props.folders}
            onPick={props.onAddToFolder}
            onClose={() => setFolderMenuOpen(false)}
          />
        )}
      </div>
      <button
        onClick={props.onDelete}
        className="rounded border border-border px-2 py-1 text-sm text-fg-muted hover:bg-bg-card hover:text-red-400"
      >
        Delete
      </button>
      <button
        onClick={props.onClear}
        className="ml-auto rounded px-2 py-1 text-sm text-fg-muted hover:bg-bg-card hover:text-fg"
      >
        Clear
      </button>
    </div>
  );
}
