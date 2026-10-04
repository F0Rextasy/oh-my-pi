# You can now configure the status line from the app

**Pick the bar's segments without opening `config.yml`.** `/statusline` takes you
to the chooser, every segment explains itself, and the bar updates as you click.

![the settings panel, after /new](https://raw.githubusercontent.com/F0Rextasy/oh-my-pi/feat/statusline-tui-editor/pr-screens/01-settings-after-new-session.png)

*Nothing above is aspirational — that is a real capture, taken after `/new`, on
the build in this branch.*

---

## What you can do now

| | |
|---|---|
| **Choose the bar's segments in the app** | `Center Bar` lists all 28 segments, each with a plain-language description. No YAML. |
| **See the effect before you commit** | The bar previews every toggle on the same frame you press it. |
| **Start from a preset** | `Default`, `Minimal`, `Compact`, `Full`, `Nerd`, `ASCII` — pick one and the bar snaps to it. |
| **Go back to where you started** | `/statusline reset` restores omp's shipped bar in one command. |
| **Place thinking effort anywhere** | `Thinking level` is a segment now, not buried inside the model's settings. |
| **Keep it across sessions** | Your bar survives `/new` — pinned by a test. |

The bar is one line. It has always been configurable — but only by editing YAML
by hand, with no preview and no way to see what you were about to break.

---

## The three bugs underneath it

Fixing the missing chooser was the easy part. Three separate defects stood
between "the setting exists" and "the bar changes", and each one failed quietly.

### 1. The segment lists were not reachable from the UI at all

The settings overlay hides an array setting that declares no `ui.options`:

```ts
// packages/tui/src/overlays/settings-selector.ts
// arrays without declared options stay config-file only
```

`statusLine.leftSegments` and `rightSegments` declared none. So the two lists a
user most wants were the two lists the UI hid. Adding `ui.options` — 28 labels
and descriptions — is what makes the rest possible.

### 2. Editing a segment wrote it to disk and then ignored it

```ts
// packages/tui/src/status-line/component.ts
const useCustomSegments = preset === "custom";
const leftSegments = useCustomSegments ? settings.leftSegments : presetDef.leftSegments;
```

On any preset but `custom`, the bar reads the preset's list and discards yours.
Worse, the live preview disagreed — `onStatusLinePreview` spreads your edited list
over the resolved settings, so the preview showed the change working. You toggled,
watched the bar update, and committed to a bar that was exactly as it was.

`handleSettingChange` now flips the preset to `custom` on the first segment edit,
which is the only reading under which the preview and the bar ever agreed.

### 3. The edit never reached the real bar

Two paths hand settings to the renderer — `status-line-host.ts` and
`InteractiveMode#syncStatusLineSettings`. Neither carried the merged list. Only
the preview received it, so the two surfaces disagreed permanently.

`/statusline reset` had the mirror problem: it reset the preset but left the
saved list behind, so reset meant *"ignore what I saved"* rather than *"forget
it"* — the next segment edit flipped the preset back to `custom` and resurrected
a list the user had already discarded.

---

## One row, not two

The two half-lists became a single `Center Bar` row. The bar is one line, and two
rows named left and right implied two bars. The renderer splits the list back into
its drawn groups using the segments every built-in preset already places at the
right end — derived from the presets themselves:

```ts
// packages/tui/src/status-line/presets.ts
export const END_OF_BAR_SEGMENTS: ReadonlySet<string> = /* every preset's right
   group, minus anything a preset also puts on the left */;
```

A new preset that follows the convention moves the boundary with it. Segments a
preset places on either side — `mode`, `context_pct`, `cost` — are deliberately
not in that set and take the left.

`Thinking level` was reachable only through the model segment's
`showThinkingLevel` option, which buried it in another row's settings and made it
impossible to place anywhere else.

---

## Verification

**No regressions.** Full `packages/tui` suite on this branch, and on a clean
`origin/main`:

| | pass | fail |
|---|---|---|
| `origin/main` | 3251 | 7 |
| this branch | 3255 | 7 |

The same seven names on both — `glyph protocol probe` ×6 and
`CompactionSummaryMessageComponent`, both pre-existing and unrelated to status
line.

**16 new tests**, all passing:

- `statusline-segment-picker.test.ts` — every segment id reaches the overlay as
  a labelled checkbox; the two half-lists do not leak back into it
- `statusline-custom-preset.test.ts` — the preset flips on the first edit, once
  on `custom` does not re-invalidate, the bar is invalidated on takeover
- `settings-deep-link.test.ts` — `/statusline` lands on the segment row on the
  first frame, retries past a cold list, and gives up on an unresolvable path
  rather than fighting the user's cursor
- `statusline-session-boundary.test.ts` — `/new` and `/clear` write **no** bar
  setting, so the configuration survives a session boundary

`tsc --noEmit` clean on `packages/tui` and `packages/coding-agent`.

---

## Notes for review

- Configs that already set `statusLine.leftSegments` / `rightSegments` keep
  working. The merged list only applies when it is present, so no existing setup
  changes behaviour.
- Defaults are unchanged. Someone who touches nothing gets a bar byte-for-byte
  identical to today's.
- The deep link is applied on the first rendered frame rather than in the
  constructor, because `selectItem` matches against a list that has not been
  populated until then. That retry is bounded at four frames — deliberately, so
  an unresolvable path cannot outlive the panel.
- I picked the name `Center Bar` because "left segments" and "right segments"
  read as two bars to anyone who has not read the renderer. If the project
  prefers the structural terms, that is a one-line label change.

## Screenshots

- [`pr-screens/01-settings-after-new-session.png`](https://raw.githubusercontent.com/F0Rextasy/oh-my-pi/feat/statusline-tui-editor/pr-screens/01-settings-after-new-session.png) — the panel after `/new`,
  showing `Status Line Preset: custom` and the `Center Bar` row with the saved
  segment list