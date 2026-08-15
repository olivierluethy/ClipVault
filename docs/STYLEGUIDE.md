# ClipVault Styleguide

The single source of truth for ClipVault's visual system. It documents what the product
**already looks like** — it is a description, not a proposal. Every new feature, extension
or change must look like it was always part of the app: reuse the tokens and patterns
below, never introduce a new colour, font size or radius on the side.

Sources of truth in code:

- `tailwind.config.js` — colour tokens, font families, keyframes/animations
- `src/styles.css` — base layer, scrollbars, container queries, syntax + markdown themes
- `src/components/Icon.tsx` — the complete icon set
- `src/components/Popover.tsx` — the canonical menu / menu-item pattern

---

## 1. Theme model

**Dark mode only.** There is no light theme, no `dark:` variants and no
`prefers-color-scheme` switching. The palette is authored directly as the default theme
on a deep near-black base with layered raised surfaces. Do not add light-mode variants.

The only media query that affects appearance is the reduced-motion guard in
`src/styles.css`, which collapses all animation/transition durations to `0.001ms`.

---

## 2. Colour

All colours live in `tailwind.config.js` under `theme.extend.colors` and are used through
their token names (`bg-bg-card`, `text-fg-muted`, `border-border`, …). Never hard-code a
hex value in a component.

### Surfaces — `bg`

| Token | Hex | Use |
| --- | --- | --- |
| `bg` (DEFAULT) | `#0E0E11` | App base: window background, sidebar, list header, inline inputs |
| `bg-card` | `#151519` | Timeline rows at rest, search input, section panels |
| `bg-raised` | `#1B1B21` | Menus, popovers, modals, toasts, top bars |
| `bg-hover` | `#232330` | Interactive hover surface, count pills |

### Foreground — `fg`

| Token | Hex | Use |
| --- | --- | --- |
| `fg` (DEFAULT) | `#ECECF1` | Primary text, active labels |
| `fg-muted` | `#8A8A97` | Secondary text, hints, resting icon buttons |
| `fg-faint` | `#5C5C68` | Metadata, type codes, placeholders, disabled |

Opacity variants in use: `text-fg/90` (secret + plain-text row content).

### Accent — `accent` (iris)

One confident hue, used sparingly for focus, active state, primary affordance and privacy.

| Token | Hex | Use |
| --- | --- | --- |
| `accent` (DEFAULT) | `#7B61FF` | Focus border, selected marker, active icon, links |
| `accent-hover` | `#8E77FF` | Hover on accent-filled elements |
| `accent-dim` | `#221E3C` | Low-tint surface behind selected/active rows |

Alpha variants in use: `accent/15` (active toggle background), `accent/40` (focus ring),
`accent/60` (focus-visible ring on menu items).

### Borders — `border`

| Token | Hex | Use |
| --- | --- | --- |
| `border` (DEFAULT) | `#26262E` | Hairline: cards, inputs, menus, dividers |
| `border-strong` | `#343440` | Emphasised edge: colour swatches, blockquote rule |

### Semantic extras (non-tokenised, used as-is)

- Destructive: `text-red-300`, `hover:bg-red-500/15`, `hover:text-red-300`
- Scrims: `bg-black/50` (modal + drawer overlay), `shadow-black/40`, `shadow-black/50`
- Toggle knob: `bg-white`
- Scrollbars (`src/styles.css`): thumb `#2C2C35`, hover `#3A3A46`, Firefox `#33333D`

### Syntax highlighting (`.hljs`, `src/styles.css`)

Base text `#C8C8D4` on a transparent background. Comments `#6E7681` italic, keywords
`#A78BFA`, strings/tags `#7EE787`, numbers `#F0A878`, titles `#D2A8FF`, attributes and
properties `#79C0FF`, built-ins `#FFA657`, deletions `#FFA198`.

### Rendered markdown (`.md-rendered`, `src/styles.css`)

Body `#CDCDD8`, headings and strong `#ECECF1`, links `#A99BFF`, blockquote `#9A9AA8`
with a `3px` `#343440` left rule, code/pre on `#0E0E11` inside a `1px #26262E` border,
table headers on `#1B1B21`.

---

## 3. Typography

Both families are self-hosted variable fonts, imported once in `src/main.tsx`.

| Role | Stack | Tailwind |
| --- | --- | --- |
| Sans (UI) | `"Space Grotesk Variable"`, `ui-sans-serif`, `system-ui`, `sans-serif` | `font-sans` (body default) |
| Mono (data) | `"JetBrains Mono Variable"`, `ui-monospace`, `SFMono-Regular`, `monospace` | `font-mono` |

**The rule:** Space Grotesk for chrome and prose; JetBrains Mono for anything that is
*data* — clipboard content, timestamps, counts, type codes, section labels, hotkeys.

`body` is `bg-bg text-fg font-sans antialiased` with `margin: 0`.

### Size scale (as used)

| Class | Size | Use |
| --- | --- | --- |
| `text-base` | 16px | Modal titles |
| `text-[15px]` | 15px | App wordmark |
| `text-sm` | 14px | Default UI text, inputs, menu items, row content |
| `text-[13px]` | 13px | Dense secondary rows |
| `text-xs` | 12px | Hints, helper text, section headings, small buttons |
| `text-[11px]` | 11px | Card metadata, the `~fuzzy` toggle, edit hints |
| `text-[10px]` | 10px | Type codes, uppercase rail/section labels |
| `text-[9px]` | 9px | Sidebar rail count badges |

### Weight & tracking

- `font-medium` (500) — buttons, emphasised labels, toast actions
- `font-semibold` (600) — headings, wordmark, markdown `strong`
- No bold (700) anywhere in the UI chrome.
- `tracking-tight` on the wordmark; `tracking-wider` on 10px uppercase mono labels;
  `tracking-[0.16em]` for the widest label treatment.

### Line height & numerals

- `leading-none` on badge-like inline elements, `leading-tight` on stacked link metadata.
- Rendered markdown body is `14px / 1.65`.
- `.tnum` (`font-variant-numeric: tabular-nums`) on every changing number — counts,
  times, badges — so digits do not jitter.

---

## 4. Spacing

Tailwind's default 4px scale, restricted in practice to a small set:

- Gaps: `gap-0.5`, `gap-1`, `gap-1.5`, `gap-2`, `gap-2.5`, `gap-3`, `gap-4`
- Padding X: `px-1`, `px-1.5`, `px-2`, `px-2.5`, `px-3`, `px-4`
- Padding Y: `py-0.5`, `py-1`, `py-1.5`, `py-2`, `py-2.5`, `py-3`
- Blocks: `p-1` (menu shell), `p-2` (sidebar), `p-3` (panels), `p-5` (modal body)

**Canonical control padding is `px-2.5 py-1.5`** — used by menu items, sidebar entries and
inline fields. Buttons in dialogs use `px-2 py-1` (small) or `px-3 py-1` (regular).

Standing dimensions: icon buttons `h-6 w-6` / `h-7 w-7` / `h-8 w-8`; the sidebar is
`w-[208px]`; the card action zone reserves `164px`; menus are `w-56` or sized to content.

---

## 5. Radii, borders, shadows

| Token | Use |
| --- | --- |
| `rounded` (4px) | Small chips, tiny icon buttons, inline inputs |
| `rounded-md` (6px) | **Default** — inputs, buttons, menu items, thumbnails |
| `rounded-lg` (8px) | Cards, panels, popovers |
| `rounded-xl` (12px) | Modal shells |
| `rounded-full` | Pills, badges, toggle knobs, the 2px active marker |

Borders are always `1px` (`border border-border`); `border-strong` marks an emphasised
edge. Dividers are `border-b border-border`, `divide-y divide-border/60` inside panels, or
a bare `h-px bg-border` rule.

Shadows appear only on floating layers:

- Popovers / dropdowns — `shadow-2xl shadow-black/40` (or `/50`)
- Modals — `shadow-2xl`
- Secondary overlays — `shadow-lg shadow-black/50`

Surfaces at rest carry no shadow; depth comes from the `bg` → `bg-card` → `bg-raised`
ladder plus a hairline border.

---

## 6. Component patterns

### Input (search / inline field)

```
rounded-md border border-border bg-bg-card py-1.5 pl-8 pr-16 text-sm text-fg
placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40
```

Leading icon: `pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint`.
Trailing controls are absolutely positioned inside the input (`right-1.5`, `top-1/2`,
`-translate-y-1/2`); the input's right padding must reserve room for **all** of them.

Compact inline inputs (sidebar rename, settings numbers) drop to
`rounded border border-border bg-bg px-1.5 py-0.5 focus:border-accent focus:outline-none`.

### Icon button

```
grid h-6 w-6 place-items-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg
```

Larger variants use `h-7 w-7`/`h-8 w-8` with `rounded-md`. Destructive icon buttons swap
the hover foreground for `hover:text-red-300`. Icons inside are `h-3.5 w-3.5` (small) or
`h-4 w-4` (regular).

### Text button

```
rounded border border-border px-3 py-1 text-sm text-fg-muted hover:text-fg hover:border-accent
```

### Toggle chip (e.g. `~fuzzy`)

```
rounded px-1.5 py-0.5 font-mono text-[11px] transition-colors
on:  bg-accent/15 text-accent
off: text-fg-faint hover:bg-bg-hover hover:text-fg-muted
```

Always carries `aria-pressed` and a `title` describing both states.

### Menu / popover

Shell: `z-[100] rounded-lg border border-border bg-bg-raised shadow-2xl shadow-black/40 p-1`.
Item: `flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none
transition-colors`, `text-fg hover:bg-bg-card focus-visible:bg-bg-card
focus-visible:ring-1 focus-visible:ring-accent/60 disabled:opacity-40`; danger variant is
`text-red-300 hover:bg-red-500/15`. Section labels are
`px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-faint`.

### Card (timeline row)

`card group relative flex cursor-pointer items-center gap-3 rounded-lg border pl-3 pr-2.5
py-2.5 transition-colors` on `bg-bg-card`; selected rows switch to `border-accent`, and an
active row gets `absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent`.

### Modal

Backdrop `fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6`;
shell `w-full max-w-lg rounded-xl border border-border bg-bg-raised shadow-2xl`; header
`flex items-center justify-between border-b border-border px-4 py-3 sm:px-5`; body
`max-h-[70vh] space-y-5 overflow-y-auto p-5`.

---

## 7. Interactive states

| State | Treatment |
| --- | --- |
| Hover (surface) | `hover:bg-bg-hover`, or `hover:bg-bg-card` on raised layers |
| Hover (text/icon) | `text-fg-muted` → `hover:text-fg` |
| Hover (outline) | `hover:border-accent`, `hover:border-border-strong` |
| Focus (input) | `focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40` |
| Focus (button) | `focus-visible:ring-1 focus-visible:ring-accent/60`, never a UA outline |
| Active / selected | `text-accent`, `border-accent`, `bg-accent/15`, or `bg-accent-dim` |
| Pressed toggle | `aria-pressed` + `bg-accent/15 text-accent` |
| Disabled | `disabled:opacity-40`, or `text-fg-faint` |
| Row-hover reveal | `opacity-0 → group-hover:opacity-100`, plus `group-focus-within` |

Transitions are `transition-colors` by default, `duration-150` when stated. Every icon is
`aria-hidden`; icon-only controls always carry an `aria-label` and usually a `title`.

---

## 8. Motion

Keyframes and durations from `tailwind.config.js`:

| Animation | Timing |
| --- | --- |
| `animate-row-in` | `0.18s ease-out both` — new timeline rows |
| `animate-pop-check` | `0.22s ease-out both` — checkbox tick |
| `animate-fade-in-up` | `0.2s ease-out both` — popovers, toasts |
| `animate-fade-in` | `0.15s ease-out both` — overlays |
| `animate-slide-in-left` | `0.2s cubic-bezier(0.22,1,0.36,1) both` — mobile drawer |

Nothing animates longer than 220ms. All motion is suppressed under
`prefers-reduced-motion: reduce`.

---

## 9. Icons

`src/components/Icon.tsx` is the **only** icon source. Every glyph is an inline SVG on a
`24×24` viewBox with `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.75}`, round
caps and joins, `aria-hidden`, and a default size of `h-4 w-4`.

Adding an icon means adding it to `Icon.tsx` through the shared `Svg` wrapper — never
inline an `<svg>` in a feature component, and never import an icon library.

Existing exports include: `CopyIcon`, `PinIcon`, `FolderIcon`, `FolderPlusIcon`,
`EditIcon`, `TrashIcon`, `EyeIcon`, `EyeOffIcon`, `QrIcon`, `ExternalLinkIcon`, `MoreIcon`,
`CheckIcon`, `SearchIcon`, `CalendarIcon`, `PlusIcon`, `TimelineIcon`, `XIcon`, `MenuIcon`,
`ShieldIcon`, `SlidersIcon`, `CleanIcon`, `TextIcon`, `LayersIcon`, `HashIcon`, `ImageIcon`,
`FlameIcon`, `RepeatIcon`, `ReplaceIcon`, `WandIcon`, `CodeIcon`, `ClockIcon`, `LockIcon`,
`SwatchIcon`.

---

## 10. Layout & responsiveness

Rows respond to **their own width** via CSS container queries (`container: card /
inline-size`), not the viewport — a card adapts identically whether the sidebar is open or
the window is narrow. Breakpoints in `src/styles.css`:

- `@container card (max-width: 500px)` — drop the type code and meta column, pin the
  action cluster visible, grow the checkbox target to 44px
- `@container card (max-width: 380px)` — the Copy button sheds its label, keeps its icon

The sidebar has three viewport modes, driven by the `.sb-full-only` / `.sb-rail-only`
helpers: drawer below `768px`, icons-only rail from `768–1023px`, full sidebar from
`1024px`.

Z-index ladder: `z-20` (sticky headers) → `z-40` (scrims) → `z-50` (drawers, toasts) →
`z-[100]` (popovers, menus).

---

## 11. Rules for new work

1. Use tokens, never literal colours.
2. Mono for data, sans for chrome.
3. `rounded-md` unless you are building a card (`lg`) or a modal (`xl`).
4. One hairline border plus the surface ladder — no new shadows on resting elements.
5. Accent is for focus, selection and one primary affordance per view. Nothing else.
6. New icons go in `Icon.tsx`.
7. Icon-only controls need `aria-label`; toggles need `aria-pressed`.
8. Transitions are `transition-colors`, ≤220ms, and must survive reduced-motion.
9. Do not add a light theme.
