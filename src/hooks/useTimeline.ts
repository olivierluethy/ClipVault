import { useCallback, useEffect, useRef, useState } from "react";
import { Item, listItems, listPinned, onItemAdded } from "../api";
import { Row, toRows } from "../lib/dates";

export function useTimeline() {
  const [pinned, setPinned] = useState<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const done = useRef(false);

  const reload = useCallback(async () => {
    setPinned(await listPinned());
    const head = await listItems(100);
    setItems(head);
    done.current = head.length < 100;
  }, []);

  const loadMore = useCallback(async () => {
    if (done.current || items.length === 0) return;
    const last = items[items.length - 1];
    const next = await listItems(100, last.created_at, last.id);
    if (next.length < 100) done.current = true;
    setItems((cur) => [...cur, ...next]);
  }, [items]);

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
