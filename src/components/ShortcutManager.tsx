import { useCallback, useEffect, useRef, useState } from "react";
import { getHotkeys, setActionHotkey } from "../api";
import { Modal, ModalButton } from "./Modal";
import {
  ACTIONS,
  ActionMeta,
  Combo,
  accelToCombo,
  comboFromEvent,
  comboToAccelerator,
  displayToken,
  findConflict,
  hasModifier,
  normalizeAccelerator,
  suggestAlternatives,
  tokensOf,
} from "../lib/shortcuts";

/** A single accelerator rendered as keycaps. */
function KeyCaps({ accel }: { accel: string }) {
  const toks = tokensOf(accel);
  if (toks.length === 0) return <span className="text-xs text-fg-faint">Not set</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {toks.map((t, i) => (
        <kbd
          key={i}
          className="rounded border border-border-strong bg-bg-card px-1.5 py-0.5 font-mono text-[11px] leading-none text-fg shadow-sm"
        >
          {displayToken(t)}
        </kbd>
      ))}
    </span>
  );
}

// A compact visual keyboard so the required keys are unmistakable while configuring.
const KEY_ROWS: string[][] = [
  ["Ctrl", "Alt", "Shift", "Super"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
  ["Space", "Enter", "Up", "Down", "Left", "Right"],
];

function keyActive(label: string, c: Combo | null): boolean {
  if (!c) return false;
  if (label === "Ctrl") return c.ctrl;
  if (label === "Alt") return c.alt;
  if (label === "Shift") return c.shift;
  if (label === "Super") return c.meta;
  return (c.key ?? "").toLowerCase() === label.toLowerCase();
}

function VisualKeyboard({ combo }: { combo: Combo | null }) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-bg p-2">
      {KEY_ROWS.map((row, ri) => (
        <div key={ri} className="flex flex-wrap justify-center gap-1">
          {row.map((label) => {
            const active = keyActive(label, combo);
            const wide = label === "Space" || label.length > 2;
            return (
              <span
                key={label}
                className={`grid h-6 place-items-center rounded border px-1 font-mono text-[10px] transition-colors ${
                  wide ? "min-w-[3rem]" : "w-6"
                } ${
                  active
                    ? "border-accent bg-accent text-bg"
                    : "border-border-strong bg-bg-card text-fg-muted"
                }`}
              >
                {label}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The record / configure dialog for one action. */
function RecorderModal({
  meta,
  current,
  hotkeys,
  onClose,
  onSaved,
}: {
  meta: ActionMeta;
  current: string;
  hotkeys: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [capturing, setCapturing] = useState(true);
  const [combo, setCombo] = useState<Combo | null>(current ? accelToCombo(current) : null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tested, setTested] = useState(false);
  const testTimer = useRef<number | null>(null);

  const accel = combo ? comboToAccelerator(combo) : null;
  const conflict = accel ? findConflict(accel, meta.action, hotkeys) : null;
  const complete = !!combo && hasModifier(combo) && !!combo.key;

  // While capturing, every keydown updates the live preview; a modifier + key commits.
  // While NOT capturing, pressing the saved combo lights the "it works" confirmation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capturing) return; // let the modal close
      if (capturing) {
        e.preventDefault();
        e.stopPropagation();
        const c = comboFromEvent(e);
        setCombo(c);
        setError(null);
        if (hasModifier(c) && c.key) setCapturing(false);
        return;
      }
      // Live test of the captured combination.
      if (accel) {
        const pressed = comboToAccelerator(comboFromEvent(e));
        if (pressed && normalizeAccelerator(pressed) === normalizeAccelerator(accel)) {
          e.preventDefault();
          setTested(true);
          if (testTimer.current) window.clearTimeout(testTimer.current);
          testTimer.current = window.setTimeout(() => setTested(false), 1400);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, accel]);

  const save = useCallback(async () => {
    if (!accel) return;
    setSaving(true);
    setError(null);
    try {
      await setActionHotkey(meta.action, accel);
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }, [accel, meta.action, onSaved, onClose]);

  const clear = useCallback(async () => {
    setSaving(true);
    try {
      await setActionHotkey(meta.action, "");
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }, [meta.action, onSaved, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Shortcut · ${meta.label}`}
      description={meta.description}
      footer={
        <>
          <ModalButton onClick={onClose}>Cancel</ModalButton>
          {(meta.optional || current) && (
            <ModalButton onClick={clear} disabled={saving}>
              {meta.optional ? "Clear" : "Reset to default"}
            </ModalButton>
          )}
          <ModalButton variant="primary" onClick={save} disabled={!complete || saving}>
            Save
          </ModalButton>
        </>
      }
    >
      <div className="space-y-3">
        {/* Capture status + the combo so far. */}
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
          <div className="min-w-0">
            {capturing ? (
              <span className="text-sm text-accent">Press the key combination…</span>
            ) : accel ? (
              <KeyCaps accel={accel} />
            ) : (
              <span className="text-sm text-fg-muted">No shortcut</span>
            )}
          </div>
          <button
            onClick={() => {
              setCapturing(true);
              setTested(false);
            }}
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"
          >
            {capturing ? "Listening…" : "Record again"}
          </button>
        </div>

        <VisualKeyboard combo={combo} />

        {/* Live test confirmation (story 11). */}
        {!capturing && complete && (
          <div className="text-center text-xs">
            {tested ? (
              <span className="text-accent">✓ It works — that's the combination.</span>
            ) : (
              <span className="text-fg-faint">Press it now to test.</span>
            )}
          </div>
        )}

        {/* Conflict warning + suggested free combinations (stories 8–10). */}
        {conflict && (
          <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <div>
              This combination conflicts with <span className="font-medium">{conflict.label}</span>
              {conflict.kind === "system" ? " and may be intercepted by your desktop." : "."}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-amber-200/70">Try:</span>
              {suggestAlternatives(meta.action, hotkeys).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setCombo(accelToCombo(s));
                    setCapturing(false);
                  }}
                  className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-amber-100 hover:bg-amber-400/20"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The full shortcut overview + editor used in Settings (issue #8). */
export function ShortcutManager() {
  const [hotkeys, setHotkeys] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<ActionMeta | null>(null);

  const load = useCallback(() => {
    getHotkeys().then(setHotkeys);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-1">
      {ACTIONS.map((meta) => {
        const accel = hotkeys[meta.action] ?? "";
        return (
          <div
            key={meta.action}
            className="flex items-center justify-between gap-3 rounded-md border border-transparent px-1 py-2 hover:border-border hover:bg-bg-hover/30"
          >
            <div className="min-w-0">
              <div className="text-sm text-fg">{meta.label}</div>
              <div className="text-xs text-fg-muted">{meta.description}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <KeyCaps accel={accel} />
              <button
                onClick={() => setEditing(meta)}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg"
              >
                Change
              </button>
            </div>
          </div>
        );
      })}
      <p className="px-1 pt-1 text-xs text-fg-faint">
        Click Change, then press the keys you want. Conflicts are flagged and you can test a
        shortcut before saving.
      </p>

      {editing && (
        <RecorderModal
          meta={editing}
          current={hotkeys[editing.action] ?? ""}
          hotkeys={hotkeys}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
