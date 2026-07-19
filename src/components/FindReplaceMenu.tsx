import { useMemo, useState } from "react";
import { Popover } from "./Popover";
import { copyText, saveTextItem } from "../api";
import { CheckIcon, CopyIcon, PlusIcon } from "./Icon";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Non-destructive find-&-replace for a single text entry: preview the match count,
 * then copy the result or save it as a new entry. Supports case-insensitive and
 * regex modes. The original item is never modified.
 */
export function FindReplaceMenu(props: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  content: string;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [flash, setFlash] = useState<"copy" | "save" | null>(null);

  const { result, matches, error } = useMemo(() => {
    if (!find) return { result: props.content, matches: 0, error: null as string | null };
    try {
      const flags = "g" + (caseSensitive ? "" : "i");
      const re = new RegExp(useRegex ? find : escapeRegExp(find), flags);
      const matches = (props.content.match(re) ?? []).length;
      // In plain mode a literal replacement (so `$` in the replacement isn't special);
      // in regex mode allow `$1` backreferences.
      const result = useRegex
        ? props.content.replace(re, replace)
        : props.content.replace(re, () => replace);
      return { result, matches, error: null as string | null };
    } catch (e) {
      return {
        result: props.content,
        matches: 0,
        error: e instanceof Error ? e.message : "Invalid pattern",
      };
    }
  }, [props.content, find, replace, caseSensitive, useRegex]);

  const flashThen = (which: "copy" | "save") => {
    setFlash(which);
    window.setTimeout(() => {
      setFlash(null);
      props.onClose();
    }, 700);
  };

  const disabled = !find || !!error;

  return (
    <Popover
      anchorEl={props.anchorEl}
      open={props.open}
      onClose={props.onClose}
      width={300}
      menu={false}
      className="z-[110] rounded-lg border border-border bg-bg-raised p-2.5 shadow-2xl shadow-black/50"
    >
      <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
        Find &amp; replace
      </div>
      <input
        autoFocus
        value={find}
        onChange={(e) => setFind(e.target.value)}
        placeholder="Find…"
        className="mb-1.5 w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
      />
      <input
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
        placeholder="Replace with…"
        className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-3 text-xs text-fg-muted">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
            className="accent-accent"
          />
          Case-sensitive
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={useRegex}
            onChange={(e) => setUseRegex(e.target.checked)}
            className="accent-accent"
          />
          Regex
        </label>
      </div>
      <div className="mt-1.5 min-h-4 text-xs">
        {error ? (
          <span className="text-red-300">{error}</span>
        ) : find ? (
          <span className="text-fg-muted">
            {matches} match{matches === 1 ? "" : "es"}
          </span>
        ) : (
          <span className="text-fg-faint">Enter a search term</span>
        )}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button
          disabled={disabled}
          onClick={() => {
            copyText(result).catch(() => {});
            flashThen("copy");
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent/10 px-2.5 py-1.5 text-sm text-accent hover:bg-accent hover:text-bg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent/10 disabled:hover:text-accent"
        >
          {flash === "copy" ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
          Copy result
        </button>
        <button
          disabled={disabled}
          onClick={() => {
            saveTextItem(result, false).catch(() => {});
            flashThen("save");
          }}
          title="Save the replaced text as a new entry"
          className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-fg-muted hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {flash === "save" ? <CheckIcon className="h-4 w-4 text-accent" /> : <PlusIcon className="h-4 w-4" />}
        </button>
      </div>
    </Popover>
  );
}
