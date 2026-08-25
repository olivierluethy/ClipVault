import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  DuplicateCluster,
  DuplicateMember,
  Item,
  deleteItem,
  duplicateClusters,
} from "../api";
import { CheckIcon, PinIcon, ShieldIcon, StackIcon, TrashIcon } from "./Icon";

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

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "identical" reads better than "100%" — it's the difference between "same thing" and
 *  "very close", which is exactly the call the user is being asked to make. */
function closenessLabel(similarity: number): string {
  return similarity >= 0.999 ? "identical" : `${Math.round(similarity * 100)}% alike`;
}

/** One entry's preview: the picture for images, the text otherwise. */
function Preview({ item }: { item: Item }) {
  const thumb = item.preview_path ?? item.file_path;
  if ((item.item_type === "image" || item.item_type === "gif") && thumb) {
    return (
      <img
        src={convertFileSrc(thumb)}
        alt=""
        className="max-h-10 shrink-0 rounded border border-border"
      />
    );
  }
  if (item.item_type === "color" && item.content) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          style={{ background: item.content }}
          className="h-5 w-5 shrink-0 rounded-md border border-border-strong"
        />
        <span className="truncate font-mono text-sm text-fg">{item.content}</span>
      </span>
    );
  }
  return (
    <span
      className={`min-w-0 flex-1 truncate font-mono text-sm ${
        item.item_type === "link" ? "text-accent" : "text-fg/90"
      }`}
    >
      {item.content}
    </span>
  );
}

/** A single entry inside a cluster. The keeper carries the accent spine used everywhere
 *  else in the app for "this is the active one"; candidates stay quiet until hovered. */
function MemberRow(props: {
  member: DuplicateMember;
  isKeeper: boolean;
  onKeep: () => void;
  onRemove: () => void;
}) {
  const { member, isKeeper } = props;
  const { item } = member;
  return (
    <div
      className={`group relative flex items-center gap-3 rounded-md border py-2 pl-3 pr-2 transition-colors ${
        isKeeper
          ? "border-accent/40 bg-accent-dim/40"
          : "border-transparent hover:border-border hover:bg-bg-hover/40"
      }`}
    >
      {isKeeper && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />
      )}

      <span className="w-9 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
        {TYPE_CODE[item.item_type]}
      </span>

      <Preview item={item} />

      <span className="flex shrink-0 items-center gap-2.5 font-mono text-[11px] text-fg-faint tnum">
        {item.pinned && <PinIcon className="h-3.5 w-3.5 text-accent" />}
        {item.reuse_count > 0 && <span title="Times reused">Used {item.reuse_count}×</span>}
        <span title="Captured">
          {dayLabel(item.created_at)} {timeLabel(item.created_at)}
        </span>
      </span>

      <span className="flex w-[7.5rem] shrink-0 justify-end">
        {isKeeper ? (
          <span className="flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
            <CheckIcon className="h-3 w-3" />
            Keeping
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span
              className="font-mono text-[11px] text-fg-faint tnum"
              title="Closeness to the entry being kept"
            >
              {closenessLabel(member.similarity)}
            </span>
            {item.pinned && (
              <span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                pinned
              </span>
            )}
          </span>
        )}
      </span>

      {/* Actions stay hidden until the row is hovered or focused, the same reveal the
          timeline rows use, so a long cluster reads as content rather than controls. */}
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {!isKeeper && (
          <button
            type="button"
            onClick={props.onKeep}
            title="Keep this one instead"
            aria-label="Keep this one instead"
            className="grid h-6 w-6 place-items-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-accent"
          >
            <CheckIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {member.removable && (
          <button
            type="button"
            onClick={props.onRemove}
            title="Remove this entry"
            aria-label="Remove this entry"
            className="grid h-6 w-6 place-items-center rounded text-fg-muted transition-colors hover:bg-bg-hover hover:text-red-300"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

/** The "Similar" view: clusters of entries that are the same thing, each proposing one
 *  keeper and offering to remove the rest — one at a time or all at once. */
export default function Duplicates(props: {
  /** Report deleted ids so the app can offer the standard undo toast. */
  onDeleted: (ids: string[]) => void;
  /** Bump when something outside this view changed the history. */
  refreshKey: number;
}) {
  const { onDeleted, refreshKey } = props;
  const [clusters, setClusters] = useState<DuplicateCluster[] | null>(null);
  const [keeperOverrides, setKeeperOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setClusters(await duplicateClusters());
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  /** Clusters with the user's keeper choices applied — an override moves the accent
   *  spine and flips which members are removal candidates. */
  const view = useMemo(() => {
    if (!clusters) return [];
    return clusters.map((c) => {
      const keeperId = keeperOverrides[c.id] ?? c.keeper_id;
      const members = c.members.map((m) => ({
        ...m,
        removable: m.item.id !== keeperId && !m.item.pinned,
      }));
      return { ...c, keeperId, members };
    });
  }, [clusters, keeperOverrides]);

  const removableIds = useMemo(
    () => view.flatMap((c) => c.members.filter((m) => m.removable).map((m) => m.item.id)),
    [view]
  );

  const remove = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0 || busy) return;
      setBusy(true);
      try {
        await Promise.all(ids.map((id) => deleteItem(id)));
        onDeleted(ids);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [busy, load, onDeleted]
  );

  if (clusters === null) {
    return <p className="px-4 py-4 text-sm text-fg-muted">Looking for duplicates…</p>;
  }

  if (view.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-xs text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-bg-card text-accent">
          <StackIcon className="h-6 w-6" />
        </div>
        <h2 className="text-sm font-medium text-fg">No duplicates found</h2>
        <p className="mt-1.5 text-sm text-fg-muted">
          Nothing in your history is close enough to count as a copy of something else.
          Lower the similarity threshold in Settings to cast a wider net.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
        <span className="font-mono text-[11px] text-fg-muted tnum">
          {view.length} {view.length === 1 ? "group" : "groups"} · {removableIds.length}{" "}
          {removableIds.length === 1 ? "entry" : "entries"} to remove
        </span>
        <button
          type="button"
          onClick={() => remove(removableIds)}
          disabled={busy || removableIds.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-accent hover:text-fg disabled:opacity-40"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Remove all duplicates
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5" style={{ scrollbarGutter: "stable" }}>
        <ul className="space-y-3">
          {view.map((cluster) => {
            const candidates = cluster.members.filter((m) => m.item.id !== cluster.keeperId);
            const identical = candidates.every((m) => m.similarity >= 0.999);
            const clusterRemovable = cluster.members
              .filter((m) => m.removable)
              .map((m) => m.item.id);
            return (
              <li
                key={cluster.id}
                className="animate-fade-in rounded-lg border border-border bg-bg-card p-1.5"
              >
                <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-faint">
                    {cluster.members.length} entries ·{" "}
                    {identical ? "identical" : "near-identical"}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(clusterRemovable)}
                    disabled={busy || clusterRemovable.length === 0}
                    className="rounded px-1.5 py-0.5 font-mono text-[11px] text-fg-faint transition-colors hover:bg-bg-hover hover:text-fg-muted disabled:opacity-40"
                  >
                    Remove {clusterRemovable.length}
                  </button>
                </div>
                <div className="space-y-0.5">
                  {cluster.members.map((m) => (
                    <MemberRow
                      key={m.item.id}
                      member={m}
                      isKeeper={m.item.id === cluster.keeperId}
                      onKeep={() =>
                        setKeeperOverrides((prev) => ({ ...prev, [cluster.id]: m.item.id }))
                      }
                      onRemove={() => remove([m.item.id])}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 flex items-center gap-1.5 px-1 text-xs text-fg-faint">
          <ShieldIcon className="h-3.5 w-3.5 shrink-0" />
          Pinned entries are never removed. Removals can be undone right after.
        </p>
      </div>
    </div>
  );
}
