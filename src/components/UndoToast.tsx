import { useEffect } from "react";

export function UndoToast({
  open,
  onUndo,
  onExpire,
}: {
  open: boolean;
  onUndo: () => void;
  onExpire: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onExpire, 5000);
    return () => clearTimeout(t);
  }, [open, onExpire]);
  if (!open) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-bg-raised border border-border rounded px-4 py-2 flex items-center gap-3 z-50">
      <span className="text-sm">Item deleted</span>
      <button onClick={onUndo} className="text-accent text-sm font-medium">
        Undo
      </button>
    </div>
  );
}
