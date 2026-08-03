# Athena Screen Redact

Chrome extension for recording the admin app. It does two things, independently:

- **Masks money** so production numbers can be recorded. Digits are replaced 1:1
  with `X`, so `GH₵12,450.00` becomes `GH₵XX,XXX.XX` — column widths and layout
  stay identical.
- **Hides demo chrome** so the shared demo records like a live surface: the demo
  control bar, in-page demo notices, the demo boundary and the reset overlay all
  come out of the page.

## Install

1. Chrome → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (`tools/screen-redact-extension`).
3. Open https://athena.wigclub.store, click the extension icon, tick **Mask amounts**.
4. Confirm the small `REDACTED` badge is showing bottom-right before you hit record.

Toggle at any time with **Alt+Shift+M** (works mid-recording).

## Options

| Option | Default | What it does |
| --- | --- | --- |
| Mask amounts | off | Masks anything with a currency marker (`GH₵`, `GHS`, `₵`, `$`, `€`, `£`, `₦`), including compact forms like `₵4.5K`. |
| Include unlabelled numbers | off | Also masks bare money-shaped numbers (`1,234.56`, `12.00`, `1,000`) that render without a symbol. |
| Blur images and charts | off | Blurs `<img>`/`<canvas>` and anything tagged `data-redact="blur"`. |
| Hide demo chrome | off | Removes the demo-only UI listed below. Independent of masking — you can hide chrome without masking amounts, and vice versa. |
| Also hide | empty | Extra CSS selectors (one per line, or comma separated) hidden alongside the built-in ones. Invalid selectors are ignored. |

## What "Hide demo chrome" removes

Matched on hooks the app already renders:

- `[aria-label="Demo controls"]` — the status bar (*Demo guide*, *Exit demo*, the
  hourly-reset line).
- `[aria-label="Demo guidance"]` — `DemoNotice` and `ServiceWorkspaceDemoNotice`.
- `[aria-labelledby="shared-demo-restricted-title"]` — the demo boundary panel.
- `[aria-labelledby="shared-demo-restore-title"]` — the reset/restore overlay.
- `[data-redact="demo"]` — escape hatch for anything new.

The homepage and inventory-import notices render as a bare `<section>` with no
attribute hook, so they are matched on their copy instead (`in the demo`,
`Demo boundary`, `Demo resets at the start of every hour`) and the nearest
`<section>`/`<aside>` within four levels is hidden. Prefer adding
`data-redact="demo"` to new demo-only UI over relying on that heuristic.

Elements are hidden with `display: none`, so the layout closes up where they were.
Nothing is unmounted — React state is untouched and turning the option off puts
everything back.

## Escape hatches

The app can opt individual elements in or out:

- `data-redact="off"` — leave this subtree alone (e.g. an order number that looks like money). Also exempts a subtree from demo-chrome hiding.
- `data-redact="demo"` — hide this element when "Hide demo chrome" is on.
- `data-redact="blur"` — blur this element while redaction is on.
- `data-redact="mask"` on an `<input>` — always mask that field.

## How it works

Text nodes are rewritten in place and re-masked through a `MutationObserver`, so
values stay masked across React re-renders and route changes. Inputs keep their
real value and are hidden with CSS `text-security` instead, so form state and
React never see a modified value. Turning redaction off restores every original
string from an in-memory map — nothing is persisted or sent anywhere.

Dates, order numbers, quantities and percentages are left alone; only money-shaped
text is touched.

## Caveats

- **Unlabelled numbers are left alone by default**, so an amount rendered without a
  currency symbol will show through. Turn the option on if a screen you're recording
  does that — but note it is a heuristic: a bare `1,000` gets masked wherever it
  appears, including in a non-financial count. `data-redact="off"` narrows it.
- Numbers baked into images or `<canvas>` charts can't be text-masked — use the
  blur option for those. SVG chart labels *are* real text and get masked.
- Do a dry run on the screens you plan to record before recording for real.
- Hiding demo chrome also hides the **reset overlay**, so an hourly demo reset will
  happen silently underneath you mid-recording — data will change with no visible
  explanation. Record between resets, or turn the option off while one runs.
- The copy-matched notices are a heuristic. Live copy containing the exact phrase
  `in the demo` would be hidden too; `data-redact="off"` narrows it.
