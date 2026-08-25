import { useCallback, useEffect, useRef, useState } from "react";
import {
  Item,
  listItems,
  listPinned,
  listByType,
  listItemsInFolder,
  listItemsRange,
  listFrequent,
  onItemAdded,
} from "../api";
import { Row, toRows } from "../lib/dates";

const USER_FOLDER_PREFIX = "user:";

// Rows are fetched in large chunks and the whole history is pulled eagerly, so the
// timeline and its date navigation are complete without the user scrolling to
// discover more (issue #6). A big page keeps the number of round-trips small.
const PAGE = 500;

export type DateRange = { fromMs: number; toMs: number; label: string };

/** A cursor-paged source (list_items / list_by_type / …). */
type PageFetcher = (
  limit: number,
  beforeCreatedAt?: number,
  beforeId?: string
) => Promise<Item[]>;

function sortDesc(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return b.id.localeCompare(a.id);
  });
}

export function useTimeline(folder: string, range: DateRange | null) {
  const [pinned, setPinned] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  // True while the complete history for the current view is still being pulled, so the
  // UI can distinguish "this is everything" from "still loading" (issue #6, story 7).
  const [loading, setLoading] = useState(true);
  // Bumped on every reload; an in-flight paging loop aborts if it's no longer current
  // (e.g. the user switched folders mid-load), so stale pages never leak in.
  const loadToken = useRef(0);

  const reload = useCallback(async () => {
    const token = ++loadToken.current;
    const current = () => token === loadToken.current;
    setLoading(true);

    // Page a cursor-based source to exhaustion, appending progressively so rows appear
    // as they arrive (fast first paint) while the full set keeps loading in the
    // background — no scrolling required to reveal the rest.
    const loadAll = async (fetchPage: PageFetcher) => {
      setItems([]);
      let acc: Item[] = [];
      let cursor: Item | undefined;
      for (;;) {
        const page = await fetchPage(PAGE, cursor?.created_at, cursor?.id);
        if (!current()) return; // aborted by a newer reload
        acc = acc.concat(page);
        setItems(acc.slice());
        if (page.length < PAGE) break;
        cursor = page[page.length - 1];
      }
      if (current()) setLoading(false);
    };

    // A date range overrides the folder view: show everything captured in that window.
    if (range) {
      setPinned([]);
      await loadAll((limit, bc, bi) => listItemsRange(range.fromMs, range.toMs, limit, bc, bi));
      return;
    }
    if (folder.startsWith(USER_FOLDER_PREFIX)) {
      const folderId = folder.slice(USER_FOLDER_PREFIX.length);
      setPinned([]);
      await loadAll((limit, bc, bi) => listItemsInFolder(folderId, limit, bc, bi));
    } else if (folder === "all") {
      setPinned(await listPinned());
      await loadAll((limit, bc, bi) => listItems(limit, bc, bi));
    } else if (folder === "frequent") {
      // Ranked-by-frequency smart view: top-N over the whole history, no paging.
      setPinned([]);
      const f = await listFrequent(100);
      if (current()) {
        setItems(f);
        setLoading(false);
      }
    } else if (folder === "image") {
      // Images + GIFs are two type buckets; page each to exhaustion, then merge.
      setPinned([]);
      setItems([]);
      const images = await collectAll((l, bc, bi) => listByType("image", l, bc, bi), current);
      const gifs = await collectAll((l, bc, bi) => listByType("gif", l, bc, bi), current);
      if (current() && images && gifs) {
        setItems(sortDesc([...images, ...gifs]));
        setLoading(false);
      }
    } else {
      setPinned([]);
      await loadAll((limit, bc, bi) => listByType(folder, limit, bc, bi));
    }
  }, [folder, range]);

  // The whole history is loaded up front now, so scroll no longer needs to fetch more.
  // Kept as a no-op so the scroll handler in App has a stable reference to call.
  const loadMore = useCallback(async () => {}, []);

  useEffect(() => {
    reload();
    const un = onItemAdded(reload);
    return () => {
      un.then((f) => f());
    };
  }, [reload]);

  // The Frequent view is a ranked list, not a chronology — render it flat (no date
  // headers) so the order reads as "most-copied first" rather than by day.
  const rows: Row[] =
    folder === "frequent" ? items.map((item) => ({ kind: "item", item })) : toRows(items);
  const flatItems: Item[] = [...pinned, ...items];
  return { pinned, items, rows, flatItems, reload, loadMore, loading };
}

/** Page a cursor-based source fully into one array, aborting if the load is superseded. */
async function collectAll(fetchPage: PageFetcher, current: () => boolean): Promise<Item[] | null> {
  let acc: Item[] = [];
  let cursor: Item | undefined;
  for (;;) {
    const page = await fetchPage(PAGE, cursor?.created_at, cursor?.id);
    if (!current()) return null;
    acc = acc.concat(page);
    if (page.length < PAGE) break;
    cursor = page[page.length - 1];
  }
  return acc;
}
