import { useMemo, useState } from "react";
import { Popover } from "./Popover";
import { CASE_TRANSFORMS, stripToPlainText, TransformDef } from "../lib/transforms";
import { smartActionsFor } from "../lib/smartActions";
import { copyText, saveTextItem, Item } from "../api";
import { CheckIcon, PlusIcon, CopyIcon, CleanIcon, TextIcon } from "./Icon";

const STRIP_TRANSFORM: TransformDef = {
  key: "strip",
  label: "Strip to plain text",
  fn: stripToPlainText,
  hint: "remove HTML / Markdown",
};

/**
 * A single transform row: the main (left) region copies the transformed result to
 * the clipboard; the trailing "+" saves it as a new history entry. Both flash a
 * check on success. Shows the transform name plus a faint example on the right.
 */
function TransformRow(props: {
  t: TransformDef;
  flash: string | null;
  icon?: React.ReactNode;
  onCopy: (t: TransformDef) => void;
  onSave: (t: TransformDef) => void;
}) {
  const copied = props.flash === `${props.t.key}:copy`;
  const saved = props.flash === `${props.t.key}:save`;
  return (
    <div className="group/tr flex items-stretch rounded-md hover:bg-bg-hover">
      <button
        type="button"
        title="Copy transformed text to the clipboard"
        onClick={() => props.onCopy(props.t)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-l-md px-2.5 py-1.5 text-left text-sm text-fg outline-none"
      >
        <span className="w-4 shrink-0 text-center text-fg-muted">
          {copied ? <CheckIcon className="h-4 w-4 text-accent" /> : props.icon ?? <CopyIcon className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{copied ? "Copied ✓" : props.t.label}</span>
        {!copied && props.t.hint && (
          <span className="shrink-0 truncate font-mono text-[10px] text-fg-faint">{props.t.hint}</span>
        )}
      </button>
      <button
        type="button"
        title="Save transformed text as a new entry"
        aria-label={`Save "${props.t.label}" result as a new entry`}
        onClick={() => props.onSave(props.t)}
        className="grid w-8 shrink-0 place-items-center rounded-r-md text-fg-faint transition-colors hover:text-accent"
      >
        {saved ? <CheckIcon className="h-4 w-4 text-accent" /> : <PlusIcon className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-mono uppercase tracking-wider text-fg-faint">
      {children}
    </div>
  );
}

/**
 * Grouped submenu of non-destructive text transforms for a single item: case
 * conversions and strip-to-plain-text (each copies out, with a "+" to save as a new
 * entry). When `onCleanCopy` is provided, the existing whitespace/link "Clean copy"
 * action is offered here too so all transforms live in one place.
 */
export function TransformMenu(props: {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  content: string;
  /** The entry itself, when available — enables the type-specific actions. */
  item?: Item;
  /** Optional: route the pre-existing backend "Clean copy" here (copy-only). */
  onCleanCopy?: () => void;
  width?: number;
}) {
  const [flash, setFlash] = useState<string | null>(null);

  // Conversions that only make sense for this kind of entry — a colour into rgb(), a URL
  // down to its domain. Empty for types with nothing type-specific to offer.
  const smartActions = useMemo(
    () => (props.item ? smartActionsFor(props.item) : []),
    [props.item]
  );

  // Flash a check on the acted row, then dismiss the menu shortly after.
  const finish = (key: string) => {
    setFlash(key);
    window.setTimeout(() => {
      setFlash(null);
      props.onClose();
    }, 620);
  };

  const onCopy = (t: TransformDef) => {
    copyText(t.fn(props.content)).catch(() => {});
    finish(`${t.key}:copy`);
  };
  const onSave = (t: TransformDef) => {
    saveTextItem(t.fn(props.content), false).catch(() => {});
    finish(`${t.key}:save`);
  };

  return (
    <Popover
      anchorEl={props.anchorEl}
      open={props.open}
      onClose={props.onClose}
      width={props.width ?? 260}
      menu={false}
      className="z-[110] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-bg-raised p-1 shadow-2xl shadow-black/50"
    >
      {smartActions.length > 0 && (
        <>
          <SectionLabel>For this {props.item?.item_type}</SectionLabel>
          {smartActions.map((t) => (
            <TransformRow key={t.key} t={t} flash={flash} onCopy={onCopy} onSave={onSave} />
          ))}
        </>
      )}
      <SectionLabel>Change case</SectionLabel>
      {CASE_TRANSFORMS.map((t) => (
        <TransformRow key={t.key} t={t} flash={flash} onCopy={onCopy} onSave={onSave} />
      ))}
      <SectionLabel>Clean up</SectionLabel>
      <TransformRow
        t={STRIP_TRANSFORM}
        flash={flash}
        icon={<TextIcon className="h-4 w-4" />}
        onCopy={onCopy}
        onSave={onSave}
      />
      {props.onCleanCopy && (
        <div className="group/tr flex items-stretch rounded-md hover:bg-bg-hover">
          <button
            type="button"
            title="Trim & collapse whitespace; strip tracking parameters from links"
            onClick={() => {
              props.onCleanCopy?.();
              finish("clean:copy");
            }}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-fg outline-none"
          >
            <span className="w-4 shrink-0 text-center text-fg-muted">
              {flash === "clean:copy" ? (
                <CheckIcon className="h-4 w-4 text-accent" />
              ) : (
                <CleanIcon className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {flash === "clean:copy" ? "Copied ✓" : "Clean up whitespace & links"}
            </span>
          </button>
        </div>
      )}
    </Popover>
  );
}
