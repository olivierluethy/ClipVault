import { useEffect, useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import {
  getExcludeSecrets,
  setExcludeSecrets,
  getFetchLinkMetadata,
  setFetchLinkMetadata,
  getAutostart,
  setAutostart,
  getSettingStr,
  setSettingStr,
  setPrivacyTimed,
  getStats,
  backupNow,
  exportData,
  importData,
  getHotkey,
  setHotkey,
  Stats,
} from "../api";

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2 cursor-pointer">
      <span className="flex flex-col">
        <span className="text-sm text-fg">{props.label}</span>
        {props.hint && <span className="text-xs text-fg-muted">{props.hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        onClick={() => props.onChange(!props.checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
          props.checked ? "bg-accent border-accent" : "bg-bg border-border"
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition-transform ${
            props.checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-1">{props.title}</h3>
      <div className="rounded-lg border border-border bg-bg-card p-3 divide-y divide-border/60">
        {props.children}
      </div>
    </section>
  );
}

function NumberField(props: {
  label: string;
  hint?: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span className="flex flex-col">
        <span className="text-sm text-fg">{props.label}</span>
        {props.hint && <span className="text-xs text-fg-muted">{props.hint}</span>}
      </span>
      <input
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => props.onCommit(v.trim() === "" ? "0" : v.trim())}
        className="w-24 rounded border border-border bg-bg px-2 py-1 text-sm text-fg text-right focus:outline-none focus:border-accent"
      />
    </label>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function Settings(props: { onClose: () => void; onPrivacyTimed?: () => void }) {
  const [excludeSecrets, setExclude] = useState(false);
  const [fetchMeta, setFetchMeta] = useState(true);
  const [autostart, setAuto] = useState(false);
  const [retentionDays, setRetentionDays] = useState("0");
  const [retentionMax, setRetentionMax] = useState("0");
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupInterval, setBackupInterval] = useState("24");
  const [backupKeep, setBackupKeep] = useState("7");
  const [hotkey, setHotkeyState] = useState("Ctrl+Alt+V");
  const [stats, setStats] = useState<Stats | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const numOr = (v: string | null, d: string) => (v && v.trim() !== "" ? v : d);
    (async () => {
      setExclude(await getExcludeSecrets());
      setFetchMeta(await getFetchLinkMetadata());
      setAuto(await getAutostart());
      setRetentionDays(numOr(await getSettingStr("retention_days"), "0"));
      setRetentionMax(numOr(await getSettingStr("retention_max_items"), "0"));
      setBackupEnabled((await getSettingStr("backup_enabled")) === "1");
      setBackupInterval(numOr(await getSettingStr("backup_interval_hours"), "24"));
      setBackupKeep(numOr(await getSettingStr("backup_keep"), "7"));
      setHotkeyState(await getHotkey());
      setStats(await getStats());
    })();
  }, []);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2600);
  };

  const doExport = async () => {
    try {
      const path = await save({
        title: "Export ClipVault data",
        defaultPath: "clipvault-export.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const n = await exportData(path);
      flash(`Exported ${n} item${n === 1 ? "" : "s"}.`);
    } catch (e) {
      flash(`Export failed: ${e}`);
    }
  };

  const doImport = async () => {
    try {
      const path = await open({
        title: "Import ClipVault data",
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      const n = await importData(path);
      flash(`Imported ${n} new item${n === 1 ? "" : "s"}.`);
      setStats(await getStats());
    } catch (e) {
      flash(`Import failed: ${e}`);
    }
  };

  const doBackup = async () => {
    try {
      const path = await backupNow();
      flash(`Backup saved: ${path}`);
    } catch (e) {
      flash(`Backup failed: ${e}`);
    }
  };

  const changeHotkey = async (accel: string) => {
    const prev = hotkey;
    setHotkeyState(accel); // optimistic
    try {
      await setHotkey(accel);
      flash(`Shortcut set to ${accel}.`);
    } catch (e) {
      setHotkeyState(prev); // registration failed — revert
      flash(`${e}`);
    }
  };

  const startTimedPrivacy = async (minutes: number) => {
    await setPrivacyTimed(minutes);
    props.onPrivacyTimed?.();
    flash(`Privacy on for ${minutes} min.`);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-bg-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            onClick={props.onClose}
            className="rounded px-2 py-1 text-sm text-fg-muted hover:text-fg hover:bg-bg-card"
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          <Section title="Capture & Privacy">
            <Toggle
              label="Exclude password-manager secrets"
              hint="Skip clipboard entries marked secret by KeePassXC, KWallet, etc."
              checked={excludeSecrets}
              onChange={(v) => {
                setExclude(v);
                setExcludeSecrets(v);
              }}
            />
            <Toggle
              label="Fetch link metadata"
              hint="Look up page title and favicon for copied links."
              checked={fetchMeta}
              onChange={(v) => {
                setFetchMeta(v);
                setFetchLinkMetadata(v);
              }}
            />
            <div className="flex items-center justify-between gap-4 py-2">
              <span className="flex flex-col">
                <span className="text-sm text-fg">Pause capture temporarily</span>
                <span className="text-xs text-fg-muted">Turn Privacy on, auto-off after…</span>
              </span>
              <div className="flex gap-1">
                {[15, 30, 60].map((m) => (
                  <button
                    key={m}
                    onClick={() => startTimedPrivacy(m)}
                    className="rounded border border-border px-2 py-1 text-xs text-fg-muted hover:text-fg hover:border-accent"
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Startup">
            <Toggle
              label="Launch ClipVault at login"
              checked={autostart}
              onChange={(v) => {
                setAuto(v);
                setAutostart(v);
              }}
            />
          </Section>

          <Section title="Shortcut">
            <div className="flex flex-col gap-2 py-2">
              <div className="flex items-center justify-between gap-4">
                <span className="flex flex-col">
                  <span className="text-sm text-fg">Open ClipVault hotkey</span>
                  <span className="text-xs text-fg-muted">
                    Global shortcut to bring up the window from anywhere.
                  </span>
                </span>
                <span className="shrink-0 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-fg">
                  {hotkey}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {["Ctrl+Alt+V", "Super+V", "Ctrl+Shift+V", "Super+Shift+V"].map((accel) => (
                  <button
                    key={accel}
                    onClick={() => changeHotkey(accel)}
                    className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
                      hotkey === accel
                        ? "border-accent bg-accent-dim/40 text-fg"
                        : "border-border text-fg-muted hover:text-fg hover:border-accent"
                    }`}
                  >
                    {accel}
                  </button>
                ))}
              </div>
              <span className="text-xs text-fg-muted">
                Some combos (e.g. Super+V) may be reserved by your desktop; if one can't
                be registered it reverts to the previous shortcut.
              </span>
            </div>
          </Section>

          <Section title="Retention">
            <NumberField
              label="Delete items older than (days)"
              hint="0 = keep forever. Pinned items are never auto-deleted."
              value={retentionDays}
              onCommit={(v) => {
                setRetentionDays(v);
                setSettingStr("retention_days", v);
              }}
            />
            <NumberField
              label="Keep at most (items)"
              hint="0 = unlimited. Oldest unpinned items are trimmed first."
              value={retentionMax}
              onCommit={(v) => {
                setRetentionMax(v);
                setSettingStr("retention_max_items", v);
              }}
            />
          </Section>

          <Section title="Backups">
            <Toggle
              label="Scheduled backups"
              hint="Periodically write a snapshot of the database."
              checked={backupEnabled}
              onChange={(v) => {
                setBackupEnabled(v);
                setSettingStr("backup_enabled", v ? "1" : "0");
              }}
            />
            <NumberField
              label="Every (hours)"
              value={backupInterval}
              onCommit={(v) => {
                setBackupInterval(v);
                setSettingStr("backup_interval_hours", v);
              }}
            />
            <NumberField
              label="Keep last (backups)"
              value={backupKeep}
              onCommit={(v) => {
                setBackupKeep(v);
                setSettingStr("backup_keep", v);
              }}
            />
            <div className="flex justify-end py-2">
              <button
                onClick={doBackup}
                className="rounded border border-border px-3 py-1 text-sm text-fg-muted hover:text-fg hover:border-accent"
              >
                Back up now
              </button>
            </div>
          </Section>

          <Section title="Data">
            <div className="flex items-center justify-between gap-4 py-2">
              <span className="text-sm text-fg">Export / import all items (JSON)</span>
              <div className="flex gap-1">
                <button
                  onClick={doExport}
                  className="rounded border border-border px-3 py-1 text-sm text-fg-muted hover:text-fg hover:border-accent"
                >
                  Export…
                </button>
                <button
                  onClick={doImport}
                  className="rounded border border-border px-3 py-1 text-sm text-fg-muted hover:text-fg hover:border-accent"
                >
                  Import…
                </button>
              </div>
            </div>
          </Section>

          <Section title="About">
            <div className="py-2 text-xs text-fg-muted space-y-1">
              <div>
                {stats
                  ? `${stats.items} item${stats.items === 1 ? "" : "s"} · ${formatBytes(stats.bytes)} on disk`
                  : "Loading…"}
              </div>
              <div>
                🔒 Database encrypted at rest (SQLCipher). The key is stored in your
                system keyring and applied automatically at startup.
              </div>
            </div>
          </Section>
        </div>

        {msg && (
          <div className="border-t border-border px-5 py-2 text-xs text-accent">{msg}</div>
        )}
      </div>
    </div>
  );
}
