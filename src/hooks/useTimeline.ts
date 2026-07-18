import { useCallback, useEffect, useRef, useState } from "react";
import { Item, listItems, listPinned, listByType, onItemAdded } from "../api";
import { Row, toRows } from "../lib/dates";

function sortDesc(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return b.id.localeCompare(a.id);
  });
}

export function useTimeline(folder: string) {
  const [pinned, setPinned] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const done = useRef(false);

  const reload = useCallback(async () => {
    if (folder === "all") {
      setPinned(await listPinned());
      const head = await listItems(100);
      setItems(head);
      done.current = head.length < 100;
    } else if (folder === "image") {
      setPinned([]);
      const [images, gifs] = await Promise.all([listByType("image", 200), listByType("gif", 200)]);
      setItems(sortDesc([...images, ...gifs]));
      done.current = true;
    } else {
      setPinned([]);
      const head = await listByType(folder, 100);
      setItems(head);
      done.current = head.length < 100;
    }
  }, [folder]);

  const loadMore = useCallback(async () => {
    if (done.current || items.length === 0) return;
    if (folder === "all") {
      const last = items[items.length - 1];
      const next = await listItems(100, last.created_at, last.id);
      if (next.length < 100) done.current = true;
      setItems((cur) => [...cur, ...next]);
    } else if (folder === "image") {
      // Filtered image+gif view is capped at 200 each for MVP; no further paging.
      return;
    } else {
      const last = items[items.length - 1];
      const next = await listByType(folder, 100, last.created_at, last.id);
      if (next.length < 100) done.current = true;
      setItems((cur) => [...cur, ...next]);
    }
  }, [items, folder]);

  useEffect(() => {
    reload();
    const un = onItemAdded(reload);
    return () => {
      un.then((f) => f());
    };
  }, [reload]);

  const rows: Row[] = toRows(items);
  const flatItems: Item[] = [...pinned, ...items];
  return { pinned, items, rows, flatItems, reload, loadMore };
}
