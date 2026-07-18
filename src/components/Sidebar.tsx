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

export function Sidebar({
  counts,
  selected,
  onSelect,
}: {
  counts: Record<string, number>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="w-[200px] shrink-0 h-full border-r border-border p-2 flex flex-col gap-1 overflow-y-auto">
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
    </nav>
  );
}
