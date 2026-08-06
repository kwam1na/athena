import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

type StorageListener = (
  changes: Record<string, { newValue: unknown }>,
  area: string,
) => void;

let storageListener: StorageListener | undefined;

function runScreenRedactExtension() {
  const contentScript = readFileSync(
    resolve(process.cwd(), "../../tools/screen-redact-extension/content.js"),
    "utf8",
  );
  Object.assign(globalThis, {
    chrome: {
      storage: {
        onChanged: {
          addListener: (listener: StorageListener) => {
            storageListener = listener;
          },
        },
        sync: {
          get: (_defaults: unknown, callback: (stored: unknown) => void) =>
            callback({ enabled: true }),
        },
      },
    },
  });

  new Function(contentScript)();
}

describe("Athena Screen Redact", () => {
  afterEach(() => {
    storageListener?.({ enabled: { newValue: false } }, "sync");
    storageListener = undefined;
    document.body.replaceChildren();
    document.documentElement.className = "";
  });

  it("masks currency values split into flip-number glyphs", () => {
    const value = "GH₵1,234.56";
    const root = document.createElement("span");
    root.dataset.motion = "flip";
    root.dataset.value = value;
    root.innerHTML = `
      <span class="sr-only">${value}</span>
      <span aria-hidden="true">${Array.from(value, (glyph) => `<span>${glyph}</span>`).join("")}</span>
    `;
    document.body.append(root);

    runScreenRedactExtension();

    expect(root.querySelector('[aria-hidden="true"]')).toHaveTextContent(
      "GH₵X,XXX.XX",
    );
  });

  it("re-masks glyphs replaced by a flip animation", async () => {
    const root = document.createElement("span");
    root.dataset.motion = "flip";
    root.dataset.value = "GH₵24.00";
    const visible = document.createElement("span");
    visible.setAttribute("aria-hidden", "true");
    root.append(visible);
    document.body.append(root);
    runScreenRedactExtension();

    visible.replaceChildren(
      ...Array.from("GH₵24.00", (glyph) => {
        const span = document.createElement("span");
        span.textContent = glyph;
        return span;
      }),
    );

    await waitFor(() => expect(visible).toHaveTextContent("GH₵XX.XX"));
  });
});
