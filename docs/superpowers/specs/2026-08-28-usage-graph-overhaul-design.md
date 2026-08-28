# Usage-Ansicht: Graph-Überarbeitung & Collection-Auswahl

**Datum:** 2026-08-28
**Betrifft:** `src/components/Analytics.tsx`, `src/App.tsx`, `src/api.ts`, `src-tauri/src/storage/usage.rs`, `src-tauri/src/ipc.rs`

## Ziel

Die „Usage"-Ansicht (Analytics-Dashboard) verständlicher und interaktiver machen. Sechs Änderungen, ausgelöst durch Nutzer-Feedback:

1. Heatmap „Usage over the last 6 months": Monats- und Jahresbeschriftung (GitHub-Stil).
2. Heatmap: sauber formatierter Hover-Tooltip statt rohem `title`-Attribut.
3. Heatmap: Klick auf einen Tag zeigt die an diesem Tag genutzten Einträge.
4. Eine klickbare „klassische Zahl" der insgesamt gespeicherten Einträge, die in die volle Bibliothek springt.
5. **Bugfix:** Eine über „Save as collection" erstellte Collection erscheint nicht in der Ordnerliste.
6. Checkboxen zur Auswahl einzelner Einträge, die dann in eine Collection gespeichert (oder kopiert) werden — statt nur „alles oder nichts".

Kein Datenbank-Schema-Wechsel nötig. Die vorhandene `usage_events`-Tabelle (`item_id`, `used_at`) und `getStats()` liefern alle Daten.

---

## 1. Monats- & Jahresbeschriftung

Über den Wochenspalten der Heatmap kommt eine Label-Zeile mit Monatskürzeln (lokalisiert via `toLocaleDateString(undefined, { month: "short" })`). Ein Kürzel wird über der Spalte gesetzt, in der ein neuer Monat beginnt (erste Spalte, deren erster Tag zu einem neuen Monat gehört). Aufeinanderfolgende Duplikate werden unterdrückt.

Im Kartenkopf (rechts, neben/statt der Legende) die Jahresangabe des sichtbaren Zeitraums:
- Gleiches Jahr über den ganzen Zeitraum → `2026`.
- Jahreswechsel im Zeitraum → `2025 – 2026`.

Wochentagslabels links werden **nicht** hinzugefügt (YAGNI).

## 2. Sauber formatierter Hover-Tooltip

Das native `title="2026-08-25: 3 uses"` wird durch einen im App-Stil gestylten Tooltip ersetzt (absolut positioniertes Element, das bei Hover über einer Zelle erscheint; Sichtbarkeit über `hidden`/State, nicht über den Browser-Titel).

Textformat (lokalisiert, Beispiel Deutsch):
- `Mo, 25. Aug 2026 — 3 Verwendungen`
- Singular: `… — 1 Verwendung`
- Null: `… — keine Verwendung`

Datum via `toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })`. Leere Platzhalterzellen (Zukunft, `count < 0`) haben keinen Tooltip.

## 3. Klick auf einen Tag → Detailpanel

### Backend (Rust)

Neue Methode in `src-tauri/src/storage/usage.rs`:

```rust
/// Distinct, nicht gelöschte Einträge, die an einem lokalen Kalendertag (YYYY-MM-DD)
/// mindestens einmal genutzt wurden, neueste Nutzung zuerst. Gedeckelt bei `limit`.
pub fn items_used_on(&self, day: &str, limit: i64) -> rusqlite::Result<Vec<ItemDto>>
```

SQL-Kern (JOIN `usage_events` → `items`, lokale Tagesgrenze wie in `usage_overview`):

```sql
SELECT i.*, MAX(e.used_at) AS last_use
FROM usage_events e
JOIN items i ON i.id = e.item_id
WHERE date(e.used_at / 1000, 'unixepoch', 'localtime') = ?1
  AND i.deleted_at IS NULL
GROUP BY i.id
ORDER BY last_use DESC
LIMIT ?2
```

Die Zeilen werden auf denselben `ItemDto` gemappt, den `list_frequent`/`list_unused` bereits liefern (Wiederverwendung des vorhandenen Row-Mappers).

Neuer IPC-Befehl in `src-tauri/src/ipc.rs`, analog zu `usage_day_counts`:

```rust
#[tauri::command]
pub fn items_used_on(state: State<AppState>, day: String, limit: i64)
    -> Result<Vec<ItemDto>, String>
```

Registrierung im `invoke_handler`/`generate_handler` an derselben Stelle wie die übrigen Usage-Befehle.

### API (TypeScript)

In `src/api.ts`:

```ts
export const itemsUsedOn = (day: string, limit = 50) =>
  invoke<Item[]>("items_used_on", { day, limit });
```

### Frontend (Heatmap)

- Neuer State in `Analytics`/`Heatmap`: `selectedDay: string | null` und `dayItems: Item[] | null`.
- Klick auf eine Zelle mit gültigem `iso`:
  - gleicher Tag → Panel schließen (`selectedDay = null`),
  - anderer/neuer Tag → `selectedDay = iso`, `itemsUsedOn(iso)` laden.
- Die gewählte Zelle bekommt einen sichtbaren Rahmen (`ring`).
- Unter der Heatmap ein Panel:
  - Kopf: formatiertes Datum + Verwendungszahl des Tages (Zahl aus der bereits vorhandenen `days`-Map, nicht aus der Länge der Liste — ein Eintrag kann mehrfach am Tag genutzt worden sein), plus ein ✕ zum Schließen.
  - Liste der Einträge, **rein lesend** (kein Copy-on-Click). Begründung: Ansehen darf den `reuse_count` nicht erneut hochzählen — genau das war ein früherer Kritikpunkt. Darstellung wie eine kompakte, abgeschnittene Monospace-Zeile pro Eintrag (`it.content ?? it.item_type`).
  - Leerfall: „Keine Einträge für diesen Tag." (kann bei gelöschten Einträgen auftreten).

## 4. Klickbare „klassische Zahl" gespeicherter Einträge

Oben in der Usage-Ansicht (über oder in der Stat-Reihe) eine hervorgehobene Kennzahl, gespeist aus dem vorhandenen `getStats().items`:

> **1 248** gespeicherte Einträge

- In `Analytics` per `getStats()` in `reload()` mitladen (neuer State `savedCount`).
- Als klickbares Element gestaltet (Button/Link-Optik), Hover zeigt dezenten Pfeil bzw. Unterstreichung.
- Klick ruft neue Prop `onNavigateHome()` auf.
- In `App.tsx` verdrahtet: `onNavigateHome={() => handleSelectFolder("all")}` — springt in die volle Bibliothek (Timeline aller Einträge).

## 5. Bugfix: neue Collection erscheint nicht unter den Ordnern

**Ursache:** Der an `Analytics` übergebene `onChanged`-Callback (`App.tsx`, ~Zeile 1032) ruft nur `reloadCounts()` und `reload()` auf, **nicht** `reloadFolders()`. Eine in `saveAsCollection` per `createFolder` erzeugte Collection wird dadurch nicht in die Sidebar-Ordnerliste (`folders`-State) geladen, bis ein anderes Ereignis (`onItemAdded`) `reloadFolders` auslöst.

**Fix:**
- `reloadFolders()` in den `onChanged`-Callback für `Analytics` aufnehmen.
- **Zusätzliche Sichtbarkeit:** Nach erfolgreichem Speichern direkt zur neuen Collection navigieren, damit sie sofort sichtbar ist. Dazu:
  - `saveAsCollection` gibt die neue Folder-ID aus `createFolder(...)` weiter an eine neue Prop `onOpenFolder(id: string)`.
  - In `App.tsx`: `onOpenFolder={(id) => handleSelectFolder(id)}` (nutzt denselben Mechanismus wie die Sidebar, `App.tsx:905`).
  - Toast bleibt bestehen und nennt den Collection-Namen.

## 6. Checkboxen zur Einzel-Auswahl für Collections

Aktuell speichert/kopiert „Save as collection" / „Copy all" immer die gesamte (auf 50 gedeckelte) Liste. Neu: pro Eintrag eine Checkbox.

- Neuer State in `Analytics`: `checked: Set<string>`.
- Jede Zeile der Einträgeliste erhält links eine Checkbox, die die ID in `checked` toggelt.
- Kopfzeile über der Liste: „alle/keine"-Umschalt-Checkbox plus Anzeige „N ausgewählt".
- Auswahl-Semantik (Fallback erhält bisheriges Verhalten):
  - Ist mindestens ein Eintrag markiert → `saveAsCollection` und `copyCollection` wirken **nur** auf die markierten Einträge.
  - Ist nichts markiert → wie bisher auf die gesamte (gedeckelte) Liste.
- Button-Beschriftung spiegelt die Auswahl: z. B. „Save 5 as collection" bzw. „Save as collection" ohne Auswahl.
- `checked` wird beim Wechsel des Filters (`frequent` ↔ `unused`) und nach erfolgreichem Speichern zurückgesetzt.

---

## Betroffene Dateien (Zusammenfassung)

| Datei | Änderung |
|-------|----------|
| `src-tauri/src/storage/usage.rs` | neue Methode `items_used_on` |
| `src-tauri/src/ipc.rs` | neuer Befehl `items_used_on` + Registrierung |
| `src/api.ts` | `itemsUsedOn(day, limit)` |
| `src/components/Analytics.tsx` | Monats-/Jahreslabels, Custom-Tooltip, Tag-Klick+Panel, `savedCount`-Kennzahl, Checkbox-Auswahl, `onNavigateHome`/`onOpenFolder`-Props |
| `src/App.tsx` | `onChanged` um `reloadFolders()` ergänzen; `onNavigateHome`- und `onOpenFolder`-Props verdrahten |

## Nicht im Umfang (YAGNI)

- Wochentagslabels links an der Heatmap.
- Kopieren/Wiederverwenden von Einträgen direkt aus dem Tages-Detailpanel (bewusst rein lesend).
- Persistenz der Auswahl über Ansichts-Wechsel hinaus.
- Änderungen am `usage_events`-Schema oder an der Zähllogik (`increment_reuse`).
