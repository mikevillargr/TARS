# Design

## Color Palette

### Light mode

| Token | Value | Role |
|---|---|---|
| `--c-canvas` | `#f6f3ec` | App background — warm off-white, not pure white |
| `--c-surface` | `#fbfaf6` | Cards, panels, sidebar — slightly lighter than canvas |
| `--c-surface-2` | `#efeadf` | Inputs, secondary surfaces, hover states |
| `--c-ink` | `#1a1714` | Primary text — warm near-black |
| `--c-ink-muted` | `#6b6357` | Secondary text, metadata |
| `--c-ink-faint` | `#948a7b` | Placeholder, disabled, `.tars-label` default |
| `--c-border` | `#d8d2c4` | Default borders |
| `--c-border-faint` | `#e8e2d4` | Subtle dividers |
| `--c-moss` | `#2d5a4f` | **Sole accent** — active nav, focus ring, primary action, live indicator |
| `--c-moss-soft` | `#e3ede9` | Moss tinted backgrounds (badges, chips) |
| `--c-amber` | `#b8651a` | Warning / status only |
| `--c-amber-soft` | `#f5e8d5` | Amber tinted backgrounds |
| `--c-rose` | `#a04848` | Error / destructive only |
| `--c-rose-soft` | `#f0dcdc` | Rose tinted backgrounds |

### Dark mode

| Token | Value | Role |
|---|---|---|
| `--c-canvas` | `#1c1a17` | App background — deep warm dark |
| `--c-surface` | `#232018` | Cards, panels |
| `--c-surface-2` | `#2d2a24` | Inputs, hover states |
| `--c-ink` | `#f0ece4` | Primary text |
| `--c-ink-muted` | `#c4bdb2` | Secondary text |
| `--c-ink-faint` | `#948a7b` | Shared with light (mid-range) |
| `--c-border` | `#3d3830` | Borders |
| `--c-border-faint` | `#2d2a24` | Subtle dividers |
| `--c-moss` | `#4a9a87` | Accent (lighter for dark bg contrast) |
| `--c-moss-soft` | `#1e3530` | Moss tinted backgrounds |
| `--c-amber` | `#d4882a` | Warning |
| `--c-amber-soft` | `#3a2a14` | Amber tinted backgrounds |
| `--c-rose` | `#c46060` | Error |
| `--c-rose-soft` | `#2e1818` | Rose tinted backgrounds |

### Ambient light

Three token-driven atmospheric washes — built from `color-mix(in srgb, ...)` so they inherit light/dark automatically:

- `.tars-ambient` — app-wide canvas: moss radial top-left (34%) + amber radial bottom-right (27%)
- `.tars-ambient-chat` — chat surface: `--c-surface` dominant + moss radial top (20%)
- `.tars-boot-glow` — chat empty state: centred moss radial (45%) for "powering on" feel

## Typography

### Font stacks

| Variable | Font | Role |
|---|---|---|
| `--font-sans` | Inter | Human layer — prose, titles, descriptions, conversation |
| `--font-mono` | JetBrains Mono | Machine/instrument layer — labels, badges, timestamps, model chips, metadata, code |
| `--font-heading` | → `--font-sans` | Headings use Inter (Lora removed in v2.7.0) |

### Type scale

| Class | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| `.tars-display` | 2rem / 32px | 600 | -0.03em | Page-level hero text, wordmark |
| `.tars-title` | 1.375rem / 22px | 600 | -0.02em | Section / page titles |
| h1–h6 | — | 600 | -0.02em | Content headings (Inter) |
| `.tars-label` | 0.6875rem / 11px | 500 | +0.14em | ALL system chrome: labels, eyebrows, column headers, status badges, counts, timestamps |
| `.tars-label--moss` | — | — | — | Accent label variant (active state, prompt eyebrow) |
| `.tars-label--muted` | — | — | — | Subdued label variant |
| `.badge` | 0.6875rem / 11px | 500 | +0.04em | Status pills (mono, uppercase) |

### Label rule

JetBrains Mono is the voice of every piece of system chrome. If it's metadata, a status, a count, a timestamp, a badge, a model tag, or a keyboard hint — it's `.tars-label` in mono. Inter is for human-readable prose only.

## Components

### Primitive components

**`.card`** — `--c-surface` background, `1px solid --c-border`, `0.5rem` radius. Depth by surface stack, never by shadow.

**`.badge`** — mono, 11px, uppercase, +0.04em tracking. Variants: `badge-moss`, `badge-amber`, `badge-rose`, `badge-neutral`.

**`.tars-mention-chip`** — inline mention node. Moss tinted bg (12%), moss text, mono font, 4px radius, 1px moss border.

**`.btn-primary`** — moss fill, parchment text, 0.375rem radius, opacity hover.
**`.btn-secondary`** — `--c-surface-2` bg, border, opacity hover.
**`.btn-ghost`** — transparent, muted text, surface-2 hover.

**`.input-field`** — `--c-surface` bg, `--c-border` border, moss focus ring (2px at 15% opacity).

### Composite patterns

**Model chip** — bracketed mono text (e.g. `[GLM-4.7]`), `.tars-label` style, no border.

**Tool call chip** — inline in chat stream. Shows connector name and action. Neutral badge style.

**TTS speaking pill** — floating amber, `AudioLines` icon, pulsing. Amber status color.

**Thinking indicator** — `tars-think-pulse` animation (scale 0.65 at 50%), `tars-think-blink` for cursor.

**Context bar** — above chat composer, shows active Mnemon injections. `.tars-label` text.

## Layout

**Shell structure**: Sidebar (desktop) / Bottom tab bar (mobile < 1024px) + Content area + Optional right panel.

**Sidebar**: `--c-surface`, hairline border. Nav items use moss as the sole active-state signal.

**Bottom tab bar**: 56px + `env(safe-area-inset-bottom)`. `.pb-safe-tab` applied to content.

**Right panel**: slides in for detail views (tasks, second brain items, meetings).

**Content area**: gets `.tars-ambient` class for the atmospheric canvas wash.

**Scrollbars**: custom, 6px, `--c-border` thumb, transparent track.

## Motion

**Keyframes defined:**
- `slideUpFade` — 12px translateY + fade in (used for cards/items entering)
- `tars-think-pulse` — breathing scale (0.65 at 50%) for thinking indicators
- `tars-think-blink` — opacity blink for text cursor
- `tars-pixel-float` — 2px vertical float

**Principles**: Ease out. No bounce. No entrance choreography on every section. Animation serves information, not decoration.

**Reduced motion**: `@media (prefers-reduced-motion: reduce)` must be applied to all animations. Static fallbacks for TTS pill (no pulse), ambient gradients (plain fill), thinking indicators (static dot).

## Spacing & Radius

- **Radius**: `0.5rem` default (`--radius`). Derived: `sm` 0.3rem, `md` 0.4rem, `lg` 0.5rem, `xl` 0.7rem.
- **Scrollbar gutter**: 6px × 6px.
- **Safe area**: bottom tab bar uses `env(safe-area-inset-bottom)` for iOS PWA.

## Iconography

Lucide React (v1.16+). Stroke icons, consistent weight. No filled icons except for intentional active states.

## Dark / Light Mode

System-aware via `prefers-color-scheme`. ThemeProvider toggles `.dark` class on `<html>`. All tokens flip automatically via CSS custom property scope. Card and utility classes have `.dark` overrides in `globals.css`.
