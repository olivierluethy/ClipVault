import { useCallback, useState } from "react";

/**
 * Tiny localStorage-backed UI preferences (issue #4): panel widths and collapsed
 * states. localStorage (not the backend settings store) because these are purely
 * per-device layout choices that should apply synchronously on first paint with no
 * round-trip or flicker.
 */

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota) — preference just isn't remembered */
  }
}

export function usePersistentBool(key: string, def: boolean) {
  const [v, setV] = useState<boolean>(() => {
    const r = read(key);
    return r == null ? def : r === "1";
  });
  const set = useCallback(
    (next: boolean) => {
      setV(next);
      write(key, next ? "1" : "0");
    },
    [key]
  );
  return [v, set] as const;
}

export function usePersistentNumber(key: string, def: number) {
  const [v, setV] = useState<number>(() => {
    const r = read(key);
    const n = r == null ? NaN : Number(r);
    return Number.isFinite(n) ? n : def;
  });
  const set = useCallback(
    (next: number) => {
      setV(next);
      write(key, String(next));
    },
    [key]
  );
  return [v, set] as const;
}
