/**
 * Athena Screen Redact — content script.
 *
 * Masks money on screen so the admin app can be recorded in production.
 * Digits are replaced 1:1 with "X" so layout and column widths stay identical.
 *
 * Everything here is display-only: text nodes are rewritten in place and inputs
 * are masked with CSS text-security, so no React state or form value changes.
 */

const DEFAULTS = {
  enabled: false,
  // Bare numbers that look like money (1,234.56 / 12.00) even without a symbol.
  aggressive: false,
  // Blur images/avatars and anything tagged data-redact="blur".
  blurMedia: false,
};

let settings = { ...DEFAULTS };

/** Currency markers the admin app renders (GHS via Intl, plus common others). */
const CURRENCY = String.raw`(?:GH₵|GHS|US\$|₵|\$|€|£|₦)`;

/** GH₵1,234.56 · GHS 1 234.56 · $12 · ₵4.5K (compact notation) */
const SYMBOL_AMOUNT = new RegExp(
  String.raw`${CURRENCY}\s?-?\d[\d,.\s]*\d?(?:\s?[KMB])?`,
  "gi"
);

/** 1,234.56 · 1,234 · 12.00 — thousands-grouped or 2-decimal bare numbers. */
const BARE_AMOUNT =
  /-?\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|-?\b\d+\.\d{2}\b/g;

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "CODE",
  "PRE",
]);

const maskDigits = (text) => text.replace(/\d/g, "X");

function redactString(value) {
  let out = value.replace(SYMBOL_AMOUNT, maskDigits);
  if (settings.aggressive) out = out.replace(BARE_AMOUNT, maskDigits);
  return out;
}

/** Original text keyed by node, so toggling off restores the real values. */
const originals = new WeakMap();

function shouldSkip(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (SKIP_TAGS.has(parent.tagName)) return true;
  if (parent.isContentEditable) return true;
  if (parent.closest("[data-redact='off']")) return true;
  return false;
}

function redactTextNode(node) {
  if (shouldSkip(node)) return;
  const source = originals.get(node) ?? node.nodeValue;
  if (!source || !/\d/.test(source)) return;
  const masked = redactString(source);
  if (masked === source) return;
  if (!originals.has(node)) originals.set(node, source);
  if (node.nodeValue !== masked) node.nodeValue = masked;
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    redactTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) redactTextNode(node);

  maskInputs(root);
}

/**
 * Inputs keep their real value (React owns it) — we hide it visually instead.
 * Only fields that currently hold a money-shaped value get masked.
 */
function maskInputs(root) {
  const scope = root.nodeType === Node.ELEMENT_NODE ? root : document;
  const inputs = scope.querySelectorAll?.("input") ?? [];
  for (const input of inputs) {
    if (input.type === "password" || input.type === "checkbox") continue;
    const value = input.value ?? "";
    SYMBOL_AMOUNT.lastIndex = 0;
    const looksLikeMoney =
      input.matches("[data-redact='mask']") ||
      (/\d/.test(value) &&
        (SYMBOL_AMOUNT.test(value) ||
          (settings.aggressive &&
            (input.inputMode === "decimal" || input.step === "0.01"))));
    input.classList.toggle("athena-redact-input", Boolean(looksLikeMoney));
  }
}

function restoreAll() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const original = originals.get(node);
    if (original !== undefined && node.nodeValue !== original) {
      node.nodeValue = original;
    }
  }
  document
    .querySelectorAll(".athena-redact-input")
    .forEach((el) => el.classList.remove("athena-redact-input"));
}

let observer = null;
let pending = new Set();
let scheduled = false;

function flush() {
  scheduled = false;
  const batch = pending;
  pending = new Set();
  observer?.disconnect();
  try {
    for (const node of batch) {
      if (node.isConnected) walk(node);
    }
  } finally {
    connectObserver();
  }
}

function schedule(node) {
  pending.add(node);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

function connectObserver() {
  if (!settings.enabled || !document.body) return;
  observer?.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function start() {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", start, { once: true });
    return;
  }

  document.documentElement.classList.toggle(
    "athena-redact-blur-media",
    settings.blurMedia
  );

  if (!observer) {
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") schedule(record.target);
        else record.addedNodes.forEach(schedule);
      }
    });
  }

  observer.disconnect();
  walk(document.body);
  connectObserver();

  // Inputs change without DOM mutations.
  document.addEventListener("input", onInput, true);
}

function onInput(event) {
  if (event.target instanceof HTMLInputElement) maskInputs(event.target.parentElement ?? document);
}

function stop() {
  observer?.disconnect();
  document.removeEventListener("input", onInput, true);
  document.documentElement.classList.remove("athena-redact-blur-media");
  if (document.body) restoreAll();
}

function apply() {
  document.documentElement.classList.toggle(
    "athena-redact-on",
    settings.enabled
  );
  if (settings.enabled) start();
  else stop();
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  settings = { ...DEFAULTS, ...stored };
  apply();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  let touched = false;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in DEFAULTS) {
      settings[key] = newValue;
      touched = true;
    }
  }
  if (touched) {
    stop();
    apply();
  }
});
