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
  ocrAvailable,
  getSimilarityThreshold,
  setSimilarityThreshold,
  listSourceApps,
  clearAllItems,
  Stats,
} from "../api";
import { formatTime, getTimeFormat, setTimeFormat, TimeFormat } from "../lib/timeFormat";
import { ShortcutManager } from "./ShortcutManager";

/** Presets for the Similar view's threshold. Discrete steps rather than a raw slider:
 *  the difference between 0.90 and 0.91 is not something anyone can judge, but the
 *  difference between "only exact copies" and "anything close" is. */
const SIMILARITY_PRESETS: { value: number; label: string; hint: string }[] = [
  { value: 0.98, label: "Strict", hint: "Only entries that are virtually identical." },
  { value: 0.9, label: "Balanced", hint: "Catches small edits and reformatting." },
  { value: 0.8, label: "Loose", hint: "Groups anything broadly alike — expect more." },
];

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

export function Settings(props: {
  onClose: () => void;
  onPrivacyTimed?: () => void;
  /** Called after the danger-zone "delete all" so the app can refresh every view. */
  onDataCleared?: () => void;
}) {
  const [excludeSecrets, setExclude] = useState(false);
  const [fetchMeta, setFetchMeta] = useState(true);
  const [autostart, setAuto] = useState(false);
  const [retentionDays, setRetentionDays] = useState("0");
  const [retentionMax, setRetentionMax] = useState("0");
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupInterval, setBackupInterval] = useState("24");
  const [backupKeep, setBackupKeep] = useState("7");
  // Kept only for the autostart hint's "open with <hotkey>" text.
  const [hotkey, setHotkeyState] = useState("Ctrl+Alt+V");
  const [autoPaste, setAutoPaste] = useState(false);
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>(getTimeFormat());
  // A representative afternoon time so the 12h/24h difference is always visible.
  const [previewTs] = useState(() => {
    const d = new Date();
    d.setHours(14, 5, 0, 0);
    return d.getTime();
  });
  const [ocrEnabled, setOcrEnabled] = useState(true);
  const [ocrAvail, setOcrAvail] = useState(true);
  const [similarity, setSimilarity] = useState(0.9);
  const [minChars, setMinChars] = useState("0");
  const [maxChars, setMaxChars] = useState("0");
  const [ignorePatterns, setIgnorePatterns] = useState("");
  const [blockedApps, setBlockedApps] = useState("");
  const [knownApps, setKnownApps] = useState<[string, number][]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // Danger zone: two-step confirm so a full wipe can't happen on a single stray click.
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

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
      setAutoPaste((await getSettingStr("auto_paste")) === "1");
      setOcrEnabled((await getSettingStr("ocr_enabled")) !== "0"); // default on
      setOcrAvail(await ocrAvailable());
      setSimilarity(await getSimilarityThreshold());
      setMinChars(numOr(await getSettingStr("capture_min_chars"), "0"));
      setMaxChars(numOr(await getSettingStr("capture_max_chars"), "0"));
      setIgnorePatterns((await getSettingStr("capture_ignore_patterns")) ?? "");
      setBlockedApps((await getSettingStr("capture_blocked_apps")) ?? "");
      setKnownApps(await listSourceApps());
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

  const doClearAll = async () => {
    setClearing(true);
    try {
      await clearAllItems();
      setStats(await getStats());
      setConfirmClear(false);
      flash("All entries deleted.");
      props.onDataCleared?.();
    } catch (e) {
      flash(`Delete failed: ${e}`);
    } finally {
      setClearing(false);
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

  /** Toggle one app in the capture blocklist, keeping the stored list newline-separated. */
  const toggleBlockedApp = (app: string) => {
    const entries = blockedApps
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);
    const has = entries.some((e) => e.toLowerCase() === app.toLowerCase());
    const next = has
      ? entries.filter((e) => e.toLowerCase() !== app.toLowerCase())
      : [...entries, app];
    const value = next.join("\n");
    setBlockedApps(value);
    setSettingStr("capture_blocked_apps", value);
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

          <Section title="Duplicates">
            <div className="flex flex-col gap-2 py-2">
              <div className="flex items-center justify-between gap-4">
                <span className="flex flex-col">
                  <span className="text-sm text-fg">How alike counts as a duplicate</span>
                  <span className="text-xs text-fg-muted">
                    Sets what the Similar view groups together.
                  </span>
                </span>
                <span className="shrink-0 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-fg tnum">
                  {Math.round(similarity * 100)}%
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {SIMILARITY_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => {
                      setSimilarity(p.value);
                      setSimilarityThreshold(p.value);
                      flash(`Similar view set to ${p.label.toLowerCase()}.`);
                    }}
                    title={p.hint}
                    aria-pressed={Math.abs(similarity - p.value) < 0.005}
                    className={`rounded border px-2 py-1 text-xs transition-colors ${
                      Math.abs(similarity - p.value) < 0.005
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border text-fg-muted hover:border-accent hover:text-fg"
                    }`}
                  >
                    {p.label} · {Math.round(p.value * 100)}%
                  </button>
                ))}
              </div>
              <span className="text-xs text-fg-muted">
                {SIMILARITY_PRESETS.find((p) => Math.abs(similarity - p.value) < 0.005)?.hint ??
                  "Custom threshold."}
              </span>
            </div>
          </Section>

          <Section title="Startup">
            <Toggle
              label="Launch ClipVault at login"
              hint={`Starts hidden in the tray so nothing is missed — open it from the tray icon or with ${hotkey}. Turn this off and ClipVault only records while you run it yourself.`}
              checked={autostart}
              onChange={(v) => {
                setAuto(v);
                setAutostart(v);
              }}
            />
          </Section>

          <Section title="Workflow">
            <Toggle
              label="Paste directly after choosing an item"
              hint="After Enter or a number key copies and hides ClipVault, auto-press Ctrl+V into the previous window. X11 only."
              checked={autoPaste}
              onChange={(v) => {
                setAutoPaste(v);
                setSettingStr("auto_paste", v ? "1" : "0");
              }}
            />
          </Section>

          <Section title="Display">
            <div className="flex items-start justify-between gap-4 py-2">
              <span className="flex flex-col">
                <span className="text-sm text-fg">Time format</span>
                <span className="text-xs text-fg-muted">
                  How timestamps are shown across the app. Preview:{" "}
                  <span className="font-mono text-fg">{formatTime(previewTs, timeFormat)}</span>
                </span>
              </span>
              <div className="mt-0.5 flex shrink-0 overflow-hidden rounded-md border border-border">
                {(["24h", "12h"] as TimeFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    aria-pressed={timeFormat === fmt}
                    onClick={() => {
                      setTimeFormatState(fmt);
                      setTimeFormat(fmt);
                    }}
                    className={`px-3 py-1 text-xs transition-colors ${
                      timeFormat === fmt
                        ? "bg-accent-dim text-fg"
                        : "text-fg-muted hover:bg-bg-hover hover:text-fg"
                    }`}
                  >
                    {fmt === "24h" ? "24-hour" : "12-hour"}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Shortcuts">
            <ShortcutManager />
          </Section>

          <Section title="What gets captured">
            <NumberField
              label="Skip anything shorter than"
              hint="Characters. 0 keeps everything."
              value={minChars}
              onCommit={(v) => {
                setMinChars(v);
                setSettingStr("capture_min_chars", v);
              }}
            />
            <NumberField
              label="Skip anything longer than"
              hint="Characters. 0 means no limit beyond the 1 MB hard cap."
              value={maxChars}
              onCommit={(v) => {
                setMaxChars(v);
                setSettingStr("capture_max_chars", v);
              }}
            />

            <div className="flex flex-col gap-1.5 py-2">
              <span className="flex flex-col">
                <span className="text-sm text-fg">Never capture apps</span>
                <span className="text-xs text-fg-muted">
                  Stronger than secret detection — nothing copied in these is stored, whether
                  or not the app marks it.
                </span>
              </span>
              {knownApps.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {knownApps.slice(0, 12).map(([app, count]) => {
                    const blocked = blockedApps
                      .toLowerCase()
                      .split(/[\n,]/)
                      .map((e) => e.trim())
                      .includes(app.toLowerCase());
                    return (
                      <button
                        key={app}
                        onClick={() => toggleBlockedApp(app)}
                        aria-pressed={blocked}
                        title={`${count} ${count === 1 ? "entry" : "entries"} from ${app}`}
                        className={`rounded border px-2 py-1 font-mono text-xs transition-colors ${
                          blocked
                            ? "border-accent bg-accent/15 text-accent"
                            : "border-border text-fg-muted hover:border-accent hover:text-fg"
                        }`}
                      >
                        {app}
                      </button>
                    );
                  })}
                </div>
              )}
              <textarea
                value={blockedApps}
                onChange={(e) => setBlockedApps(e.target.value)}
                onBlur={() => setSettingStr("capture_blocked_apps", blockedApps)}
                placeholder="keepassxc&#10;bitwarden"
                spellCheck={false}
                className="min-h-16 w-full resize-y rounded border border-border bg-bg p-2 font-mono text-xs text-fg focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-fg-muted">
                One per line, matched loosely — “keepass” covers “KeePassXC”.
              </span>
            </div>

            <div className="flex flex-col gap-1.5 py-2">
              <span className="flex flex-col">
                <span className="text-sm text-fg">Never capture text matching</span>
                <span className="text-xs text-fg-muted">
                  One regular expression per line. For content only you can recognise — an
                  internal ticket format, a token shape.
                </span>
              </span>
              <textarea
                value={ignorePatterns}
                onChange={(e) => setIgnorePatterns(e.target.value)}
                onBlur={() => setSettingStr("capture_ignore_patterns", ignorePatterns)}
                placeholder="^ghp_[A-Za-z0-9]{36}$&#10;INTERNAL-\\d+"
                spellCheck={false}
                className="min-h-16 w-full resize-y rounded border border-border bg-bg p-2 font-mono text-xs text-fg focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-fg-muted">
                An invalid pattern is skipped, not fatal — the rest keep working.
              </span>
            </div>
          </Section>

          <Section title="Images">
            <Toggle
              label="Search text inside images (OCR)"
              hint={
                ocrAvail
                  ? "Recognize text in captured images so you can search for it."
                  : "Install the 'tesseract' package to enable image-text search."
              }
              checked={ocrEnabled && ocrAvail}
              onChange={(v) => {
                if (!ocrAvail) return;
                setOcrEnabled(v);
                setSettingStr("ocr_enabled", v ? "1" : "0");
              }}
            />
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

          <Section title="Danger zone">
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="flex flex-col">
                <span className="text-sm text-fg">Delete all entries</span>
                <span className="text-xs text-fg-muted">
                  Permanently removes every entry, snippet, collection and usage record.
                  Settings are kept. This cannot be undone.
                </span>
              </div>
              {!confirmClear ? (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="shrink-0 rounded border border-red-500/60 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10"
                >
                  Delete all…
                </button>
              ) : (
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => setConfirmClear(false)}
                    disabled={clearing}
                    className="rounded border border-border px-3 py-1 text-sm text-fg-muted hover:text-fg disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={doClearAll}
                    disabled={clearing}
                    className="rounded border border-red-500 bg-red-500/15 px-3 py-1 text-sm font-medium text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    {clearing ? "Deleting…" : "Delete everything"}
                  </button>
                </div>
              )}
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
