# Athena Screen Redact

Chrome extension that masks money on screen so the admin app can be screen-recorded
in production. Digits are replaced 1:1 with `X`, so `GH₵12,450.00` becomes
`GH₵XX,XXX.XX` — column widths and layout stay identical.

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

## Escape hatches

The app can opt individual elements in or out:

- `data-redact="off"` — leave this subtree alone (e.g. an order number that looks like money).
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
