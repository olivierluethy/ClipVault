import { useSyncExternalStore } from "react";
import { getSettingStr, setSettingStr } from "../api";

/** The user's preferred clock format for timestamps (issue #11). */
export type TimeFormat = "24h" | "12h";

const KEY = "time_format";

// A tiny reactive store so every timestamp on screen updates the instant the
// preference changes, without threading the value through the component tree.
let current: TimeFormat = "24h";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Format an epoch-ms timestamp as a time of day in the given (or current) format. */
export function formatTime(ts: number, fmt: TimeFormat = current): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  const h = d.getHours();
  const m = d.getMinutes();
  if (fmt === "12h") {
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${p(m)} ${period}`;
  }
  return `${p(h)}:${p(m)}`;
}

export const getTimeFormat = (): TimeFormat => current;

/** Change and persist the preference, notifying every subscriber immediately. */
export async function setTimeFormat(fmt: TimeFormat): Promise<void> {
  if (fmt !== current) {
    current = fmt;
    emit();
  }
  await setSettingStr(KEY, fmt);
}

/** Load the persisted preference once at startup (defaults to 24h). */
export async function loadTimeFormat(): Promise<void> {
  const v = await getSettingStr(KEY);
  const next: TimeFormat = v === "12h" ? "12h" : "24h";
  if (next !== current) {
    current = next;
    emit();
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React hook returning the current time format and re-rendering on change. */
export function useTimeFormat(): TimeFormat {
  return useSyncExternalStore(subscribe, getTimeFormat, getTimeFormat);
}
