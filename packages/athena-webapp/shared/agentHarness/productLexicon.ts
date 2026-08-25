/**
 * Product lexicon (kernel; runtime-neutral, browser-safe).
 *
 * The machine-readable projection of `docs/product-copy-tone.md` that the
 * harness enforces mechanically instead of by instruction:
 *
 * - `annotateMoneyDisplays` and `annotateDateDisplays` run at the result
 *   boundary: every money-shaped value and exact calendar date the model is
 *   shown carries an operator-ready display string, so quoting the right
 *   value is the path of least resistance and raw storage forms never need to
 *   be interpreted in prose.
 * - `collectNarrativeEvidence` harvests, from those same results, the tokens
 *   an operator must never see echoed back: backend field names, raw enum
 *   spellings, and minor-unit amounts.
 * - `senseTone` checks a committed narrative against that harvested evidence
 *   plus the run's namespaces and refs. Every finding names the exact fix, in
 *   the same contract style as the kernel's other denials. Tokens the
 *   operator used in the question are theirs — never findings.
 *
 * The app-wide lexicon lives here; a profile (surface) may overlay it with
 * its own labels via `mergeLexicons`. Detection is structural (camelCase,
 * snake_case, namespaces, refs, minor-unit magnitudes), so plain English
 * never trips it; the lexicon only improves the wording of fixes.
 */
import { currencyFormatter } from "../currencyFormatter";

// ---------------------------------------------------------------------------
// Lexicon
// ---------------------------------------------------------------------------

export type AgentProductLexicon = {
  /** Raw enum spelling → operator wording (`close_blocked` → "close blocked"). */
  readonly enumLabels: { readonly [raw: string]: string };
  /** Backend field name → operator wording (`registerSession` → "drawer"). */
  readonly fieldLabels: { readonly [raw: string]: string };
  /** Capability path → operator phrase (`reports.daySales` → "the daily sales report"). */
  readonly namespaceLabels?: { readonly [namespace: string]: string };
};

/** App-wide labels drawn from the product's own UI copy. */
export const APP_PRODUCT_LEXICON: AgentProductLexicon = {
  enumLabels: {
    close_blocked: "close blocked",
    in_stock: "in stock",
    mobile_money: "mobile money",
    locally_closed_pending_sync: "closeout syncing",
    daily_close: "daily close",
    operations_queue: "operations queue",
    no_usable_sources: "no usable sources",
    needs_clarification: "needs clarification",
  },
  fieldLabels: {
    registerSession: "drawer",
    registerSessions: "drawers",
    lifecycleStage: "where the day stands",
    openingFloatMinor: "opening float",
    varianceMinor: "variance",
    transactionCount: "number of sales",
    operatingDate: "store day",
  },
};

export function mergeLexicons(base: AgentProductLexicon, overlay: AgentProductLexicon): AgentProductLexicon {
  return {
    enumLabels: { ...base.enumLabels, ...overlay.enumLabels },
    fieldLabels: { ...base.fieldLabels, ...overlay.fieldLabels },
    namespaceLabels: { ...base.namespaceLabels, ...overlay.namespaceLabels },
  };
}

/** `lifecycleStage` → "lifecycle stage", `close_blocked` → "close blocked". */
export function humanizeToken(token: string): string {
  return token
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

// ---------------------------------------------------------------------------
// Money display
// ---------------------------------------------------------------------------

export type AgentMoneyAmount = { readonly amount: number; readonly currency: string };

/** The manifest's `money` field kind serializes as `{ amount, currency }` in minor units. */
export function isMoneyValue(value: unknown): value is AgentMoneyAmount {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as { amount?: unknown; currency?: unknown; display?: unknown };
  // Exactly the manifest money serialization ({amount, currency}, plus our own
  // display annotation) — a flat result row that merely CONTAINS amount and
  // currency keys is data whose siblings must still be walked and harvested.
  const keys = Object.keys(record);
  if (keys.length > 3 || !keys.every((key) => key === "amount" || key === "currency" || key === "display")) return false;
  return (
    typeof record.amount === "number" &&
    Number.isInteger(record.amount) &&
    typeof record.currency === "string" &&
    /^[A-Za-z]{3}$/.test(record.currency) &&
    (record.display === undefined || typeof record.display === "string")
  );
}

/**
 * Format a minor-unit amount the way the app displays it: the product glyph
 * (`GH₵` for GHS), grouping, and minor units only when they are non-zero —
 * `GH₵500`, never `GH₵500.00` (`src/lib/pos/displayAmounts.ts` convention).
 */
export function formatMinorMoney(amountMinor: number, currency: string): string {
  const units = amountMinor / 100;
  const hasMinor = Math.abs(amountMinor) % 100 !== 0;
  return currencyFormatter(currency, {
    minimumFractionDigits: hasMinor ? 2 : 0,
    maximumFractionDigits: hasMinor ? 2 : 0,
  }).format(units);
}

const WALK_DEPTH_MAX = 16;

/**
 * Deep-annotate every money-shaped value with its `display` string. Values
 * that already carry `display` keep it. Non-money data passes through
 * untouched.
 */
export function annotateMoneyDisplays(value: unknown, depth = 0): unknown {
  if (depth > WALK_DEPTH_MAX || typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => annotateMoneyDisplays(item, depth + 1));
  const record = value as { readonly [key: string]: unknown };
  if (isMoneyValue(record)) {
    return "display" in record ? record : { ...record, display: formatMinorMoney(record.amount, record.currency) };
  }
  const annotated: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) annotated[key] = annotateMoneyDisplays(entry, depth + 1);
  return annotated;
}

// ---------------------------------------------------------------------------
// Date display
// ---------------------------------------------------------------------------

const OPERATING_DATE_PATTERN = /^([1-9]\d{3})-(\d{2})-(\d{2})$/;
const OPERATING_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Render a date-only value without allowing the runtime timezone to move it
 * onto another calendar day. Invalid dates are not annotated.
 */
export function formatOperatingDateDisplay(value: string): string | null {
  const match = OPERATING_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return OPERATING_DATE_FORMATTER.format(date);
}

/**
 * Keep canonical date-only fields intact and add `<field>Display` beside each
 * one in the model-visible copy. Existing product-authored display fields win.
 */
export function annotateDateDisplays(value: unknown, depth = 0): unknown {
  if (depth > WALK_DEPTH_MAX || typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => annotateDateDisplays(item, depth + 1));
  }

  const record = value as { readonly [key: string]: unknown };
  const annotated: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    annotated[key] = annotateDateDisplays(entry, depth + 1);
    if (
      key.endsWith("Display") ||
      typeof entry !== "string" ||
      Object.hasOwn(record, `${key}Display`)
    ) {
      continue;
    }
    const display = formatOperatingDateDisplay(entry);
    if (display) annotated[`${key}Display`] = display;
  }
  return annotated;
}

// ---------------------------------------------------------------------------
// Narrative evidence harvest
// ---------------------------------------------------------------------------

export type AgentNarrativeEvidence = {
  readonly fieldNames: readonly string[];
  readonly enumLiterals: readonly string[];
  readonly moneyAmounts: readonly AgentMoneyAmount[];
  /** True when a harvest cap was hit: tone policing is degraded for this result. */
  readonly truncated: boolean;
};

const INTERNAL_NAME_PATTERN = /(?:[a-z0-9][A-Z]|_)/; // camelCase joint or snake_case
const ENUM_LITERAL_PATTERN = /^[a-z]+(?:_[a-z]+)+$/;
/**
 * A hex run long enough to be an opaque identifier's hash tail. The letter
 * requirement keeps plain numbers (counts, amounts, timestamps) out.
 */
const OPAQUE_HEX_RUN_PATTERN = /(?=[0-9a-f]*[a-f])[0-9a-f]{16,}/g;
/** The same shape without /g: `.test` on a global regex is stateful. */
const OPAQUE_HEX_RUN_TEST = /(?=[0-9a-f]*[a-f])[0-9a-f]{16,}/;

/** Harvest, from a model-visible result, the internal tokens prose must not echo. */
const EVIDENCE_FIELD_CAP = 200;
const EVIDENCE_ENUM_CAP = 200;
const EVIDENCE_MONEY_CAP = 64;

export function collectNarrativeEvidence(value: unknown): AgentNarrativeEvidence {
  const fieldNames = new Set<string>();
  const enumLiterals = new Set<string>();
  const moneyKeys = new Set<string>();
  const moneyAmounts: AgentMoneyAmount[] = [];
  let truncated = false;
  const harvestMoney = (amount: number, currency: string) => {
    const moneyKey = `${amount}:${currency.toUpperCase()}`;
    if (moneyKeys.has(moneyKey)) return;
    if (moneyAmounts.length >= EVIDENCE_MONEY_CAP) {
      truncated = true;
      return;
    }
    moneyKeys.add(moneyKey);
    moneyAmounts.push({ amount, currency: currency.toUpperCase() });
  };
  const walk = (node: unknown, depth: number): void => {
    if (depth > WALK_DEPTH_MAX || typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = node as { readonly [key: string]: unknown };
    if (isMoneyValue(record)) {
      harvestMoney(record.amount, record.currency);
      return;
    }
    // A flat row carrying amount+currency beside other keys is not annotated
    // (mutating it is the risk) but its amount IS harvested, so a raw echo of
    // it stays visible to the rewrite and the sensor.
    const loose = record as { amount?: unknown; currency?: unknown };
    if (typeof loose.amount === "number" && Number.isInteger(loose.amount) && typeof loose.currency === "string" && /^[A-Za-z]{3}$/.test(loose.currency)) {
      harvestMoney(loose.amount, loose.currency);
    }
    for (const [key, entry] of Object.entries(record)) {
      if (INTERNAL_NAME_PATTERN.test(key)) {
        if (fieldNames.size < EVIDENCE_FIELD_CAP) fieldNames.add(key);
        else if (!fieldNames.has(key)) truncated = true;
      }
      if (typeof entry === "string" && ENUM_LITERAL_PATTERN.test(entry)) {
        if (enumLiterals.size < EVIDENCE_ENUM_CAP) enumLiterals.add(entry);
        else if (!enumLiterals.has(entry)) truncated = true;
      }
      walk(entry, depth + 1);
    }
  };
  walk(value, 0);
  return { fieldNames: [...fieldNames], enumLiterals: [...enumLiterals], moneyAmounts, truncated };
}

// ---------------------------------------------------------------------------
// Sources footer normalization
// ---------------------------------------------------------------------------

const FOOTER_HEADER = /\n+[ \t]*(?:sources?|citations?|refs?)(?:[ \t]*\([^)\n]{0,40}\))?[ \t]*:/gi;

/**
 * Strip a model-authored trailing "Sources:" footer. The answer surface
 * already renders the committed citations under "Sources", so a footer whose
 * lines are nothing but refs duplicates the UI in the wrong vocabulary — and
 * neither disclosure nor a corrective denial stopped the habit. Conservative
 * by construction: only a TRAILING section is considered, and only when every
 * non-empty line in it carries a ref token; a footer holding real prose, or a
 * sources mention mid-answer, is left exactly as written.
 */
const REF_TOKEN_ALL = /attempt_v\d[^\s,;)]*|citation:v\d[^\s,;)]*/g;

/** A footer line is refs-only when, with refs and list punctuation removed, no figures and only a short label remain. */
function isRefsOnlyLine(line: string): boolean {
  const refs = line.match(REF_TOKEN_ALL) ?? [];
  if (refs.length === 0) return false;
  const remainder = line.replace(REF_TOKEN_ALL, " ").replace(/[-*\u2022.,;:()[\]|/]/g, " ").replace(/\s+/g, " ").trim();
  if (/[\d\u20b5]/.test(remainder) || /\bGH\b/.test(remainder)) return false;
  // Per-ref label budget: "the daily sales report (ref)" is a label; "drawer
  // left open overnight, manager paged (ref)" is a fact and must be kept.
  const words = remainder.length === 0 ? 0 : remainder.split(" ").length;
  return words <= refs.length * 4 && remainder.length <= refs.length * 40;
}

function stripSourcesFooterOnce(narrative: string): string {
  let header: RegExpExecArray | null = null;
  FOOTER_HEADER.lastIndex = 0;
  for (let match = FOOTER_HEADER.exec(narrative); match; match = FOOTER_HEADER.exec(narrative)) header = match;
  // A header only reachable via newline deliberately never matches position 0:
  // a narrative that IS a sources footer must not be stripped to nothing.
  if (!header) return narrative;
  const section = narrative.slice(header.index + header[0].length);
  const lines = section.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || !lines.every(isRefsOnlyLine)) return narrative;
  const stripped = narrative.slice(0, header.index).trimEnd();
  // Never strip a narrative to nothing (a leading-newline footer-only text
  // would otherwise commit as an empty answer).
  return stripped.length > 0 ? stripped : narrative;
}

export function stripSourcesFooter(narrative: string): string {
  // Fixpoint: stacked footers ("Sources:" then "Refs:") strip one per pass.
  let current = narrative;
  for (let pass = 0; pass < 4; pass++) {
    const next = stripSourcesFooterOnce(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Narrative normalization (the operatorMessages.ts idea, applied to the answer)
// ---------------------------------------------------------------------------

export type AgentNormalizeNarrativeOptions = {
  readonly evidence: Pick<AgentNarrativeEvidence, "fieldNames" | "enumLiterals" | "moneyAmounts">;
  readonly namespaces: readonly string[];
  readonly lexicon: AgentProductLexicon;
  readonly question: string;
  /** The refs this run handed out; scrubbed from prose exactly, on top of the shape-based scrub. */
  readonly refs?: readonly string[];
};

const OPAQUE_SCRUB_REPLACEMENT = "the cited record";
/** A ref-shaped data identifier: kind prefix plus a dotted opaque tail. */
const REF_CLUSTER_PATTERN = /\b(?:resource|source|citation|attempt)[:_.][A-Za-z0-9_.:-]*/g;

/**
 * Replace opaque identifiers with operator wording. This is what retires the
 * `ref_in_prose` denial for the common cases: the answer surface renders the
 * committed citations itself, so an identifier in prose carries nothing the
 * operator can use — and a corrective denial costs a full provider round. The
 * sensor stays armed behind this as the backstop.
 */
function scrubOpaqueIdentifiers(narrative: string, options: { readonly refs: readonly string[]; readonly asked: (token: string) => boolean }): string {
  let text = narrative;
  for (const ref of options.refs) {
    if (options.asked(ref)) continue;
    text = text.split(ref).join(OPAQUE_SCRUB_REPLACEMENT);
  }
  text = text.replace(REF_CLUSTER_PATTERN, (match) => (options.asked(match) ? match : OPAQUE_SCRUB_REPLACEMENT));
  // Any remaining token carrying a hash tail (a mangled ref's second
  // fragment, a bare id) is an identifier wherever it appears. Trailing
  // sentence punctuation survives the replacement.
  text = text.replace(/\S+/g, (token) => {
    if (!OPAQUE_HEX_RUN_TEST.test(token) || options.asked(token)) return token;
    const trailing = token.match(/[.,;:!?)\]]+$/) ?? null;
    return OPAQUE_SCRUB_REPLACEMENT + (trailing ? trailing[0] : "");
  });
  // A mangled ref scrubs as two adjacent fragments; say it once.
  text = text.replace(
    new RegExp(`${OPAQUE_SCRUB_REPLACEMENT}(?:[\\s]+${OPAQUE_SCRUB_REPLACEMENT})+`, "g"),
    OPAQUE_SCRUB_REPLACEMENT,
  );
  return text;
}

/**
 * Deterministically rewrite internal tokens in a committed narrative to their
 * operator wording — the same mechanism `operatorMessages.ts` applies to
 * backend errors, extended to the agent's answer. Evidence-bound by
 * construction: only tokens the run itself served the model (harvested field
 * names, enum spellings, minor-unit amounts) and the grant's namespaces are
 * ever rewritten; free prose is untouchable, and tokens the operator used in
 * the question are theirs.
 */
export function normalizeNarrative(narrative: string, options: AgentNormalizeNarrativeOptions): string {
  const question = options.question.toLowerCase();
  const asked = (token: string) => question.includes(token.toLowerCase());
  let text = scrubOpaqueIdentifiers(narrative, { refs: options.refs ?? [], asked });
  const rewriteWord = (token: string, replacement: string) => {
    text = text.replace(new RegExp("\\b" + escapeRegExp(token) + "\\b", "g"), replacement);
  };
  // Rewrite what the run served the model AND what the lexicon itself names:
  // lexicon keys are curated-internal by construction, so a catalog-known
  // token the model used without reading it is still safely rewritable.
  const namespaceTokens = [...new Set([...options.namespaces, ...Object.keys(options.lexicon.namespaceLabels ?? {})])]
    .sort((left, right) => right.length - left.length); // longest first: a namespace must not rewrite the head of a longer one
  for (const namespace of namespaceTokens) {
    if (asked(namespace) || !text.includes(namespace)) continue;
    const namespaceLabels = options.lexicon.namespaceLabels ?? {};
    const label = Object.hasOwn(namespaceLabels, namespace)
      ? namespaceLabels[namespace]
      : humanizeToken(namespace.split(".")[1] ?? namespace);
    // Absorb a trailing verb mention; the boundary guards forbid rewriting
    // inside a longer token ("inventory.positionsHistory") or a dotted path,
    // and a substitution landing at a sentence start keeps the capital.
    text = text.replace(
      new RegExp(escapeRegExp(namespace) + "(?:\\.(?:get|list))?(?!\\w)(?!\\.\\w)", "g"),
      (match: string, offset: number, whole: string) => {
        const before = whole.slice(0, offset);
        const sentenceStart =
          offset === 0 || ((/[.!?]\s+$|\n\s*$/.test(before)) && !/(?:\be\.g\.|\bi\.e\.|\bvs\.|\betc\.)\s+$/i.test(before));
        return sentenceStart ? label.charAt(0).toUpperCase() + label.slice(1) : label;
      },
    );
  }
  for (const name of new Set([...options.evidence.fieldNames, ...Object.keys(options.lexicon.fieldLabels)])) {
    if (!INTERNAL_NAME_PATTERN.test(name) || asked(name)) continue;
    // Structure-preserving only: "lifecycleStage" -> "lifecycle stage" keeps
    // the token's part of speech, so the sentence still parses. Free-form
    // labels ("where the day stands") would garble grammar mid-sentence —
    // they belong in disclosure and denial fixes, where the model can
    // restructure the sentence around them.
    rewriteWord(name, humanizeToken(name));
  }
  for (const literal of new Set([...options.evidence.enumLiterals, ...Object.keys(options.lexicon.enumLabels)])) {
    if (asked(literal)) continue;
    // Dotted keys (workflow step ids) would half-humanize ("eod.auto complete");
    // their curated labels stay in disclosure and fix text only.
    if (literal.includes(".")) continue;
    rewriteWord(literal, humanizeToken(literal));
  }
  const grouping = new Intl.NumberFormat("en-US");
  const decimalGrouping = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // The correct major-unit rendering of every harvested amount: a matched span
  // whose NUMERIC content equals one of these is a correct figure in any
  // spelling ("GH\u20b514,149", "GHS 14,149", "$14,149") and is never rewritten.
  const knownMajorDigits = new Set<string>();
  for (const money of options.evidence.moneyAmounts) {
    const units = money.amount / 100;
    knownMajorDigits.add(Math.abs(money.amount) % 100 !== 0 ? decimalGrouping.format(units) : grouping.format(units));
  }
  for (const money of options.evidence.moneyAmounts) {
    if (Math.abs(money.amount) < 10_000) continue; // below GH\u20b5100, plain integers collide with counts
    const display = formatMinorMoney(money.amount, money.currency);
    for (const spelling of [grouping.format(money.amount), String(money.amount)]) {
      if (!text.includes(spelling)) continue;
      // The lookbehind also refuses any currency symbol, so the pipeline's own
      // inserted display is never re-matched bare in a later pass.
      const pattern = new RegExp(
        "(?:\\b(?:" + escapeRegExp(money.currency) + "|GHC)\\s*|GH\u20b5\\s*|(?<![\\d,.\\p{Sc}]))(?<![\\d,])" + escapeRegExp(spelling) + "(?!\\d|,\\d|\\.\\d)",
        "gu",
      );
      text = text.replace(pattern, (match) => {
        const digits = match.replace(/^[^0-9-]+/, "");
        return knownMajorDigits.has(digits) ? match : display;
      });
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Tone sensor
// ---------------------------------------------------------------------------

export type AgentToneFindingCode =
  | "evidence_truncated"
  | "stub_narrative"
  | "ref_in_prose"
  | "namespace_path"
  | "internal_field_name"
  | "raw_enum_literal"
  | "raw_minor_amount";

export type AgentToneFinding = {
  readonly code: AgentToneFindingCode;
  readonly token: string;
  readonly fix: string;
};

export type AgentToneSensorInput = {
  readonly narrative: string;
  readonly question: string;
  readonly fieldNames: readonly string[];
  readonly enumLiterals: readonly string[];
  readonly moneyAmounts: readonly AgentMoneyAmount[];
  readonly namespaces: readonly string[];
  readonly refs: readonly string[];
  readonly lexicon: AgentProductLexicon;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPresent(narrative: string, token: string): boolean {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`).test(narrative);
}

/** Meta-narration about the reads, or a label standing in for the answer. */
const STUB_PATTERNS: readonly RegExp[] = [
  /\b(?:was|were)\s+(?:read|fetched)\b/i,
  /^I\s+(?:read|checked|fetched|reviewed)\b/i,
  /\bwill\s+report\b/i,
  /^Summary\s+(?:comparing|for|of)\b[^.]*\.?$/,
];

/**
 * Check a committed narrative against the run's own evidence. Findings carry
 * the exact fix; anything the operator's question already contains is waived.
 */
export function senseTone(input: AgentToneSensorInput): readonly AgentToneFinding[] {
  const findings: AgentToneFinding[] = [];
  const narrative = input.narrative.trim();
  const question = input.question.toLowerCase();
  const asked = (token: string) => question.includes(token.toLowerCase());

  // A complete answer may mention a read in passing; a stub IS the mention.
  // Only a short narrative can be a stub (observed stubs run 88-168 chars).
  const STUB_MAX_CHARS = 320;
  for (const pattern of STUB_PATTERNS) {
    if (narrative.length <= STUB_MAX_CHARS && pattern.test(narrative)) {
      findings.push({
        code: "stub_narrative",
        token: narrative.slice(0, 80),
        fix: "The narrative is the full answer the operator reads — state what they asked for, not what was read or what you will do.",
      });
      break;
    }
  }
  for (const ref of input.refs) {
    if (narrative.includes(ref)) {
      findings.push({ code: "ref_in_prose", token: ref, fix: "Refs belong in citedAttemptRefs and citations, never in the narrative." });
    }
  }
  // Opaque identifiers from DATA (`resource:...`/`source:...` refs, or any
  // ref the model rewrote — observed: underscores lexicon-swapped to spaces)
  // never exact-match `input.refs`. Their hash tails still give them away: a
  // 16+ character hex run with at least one letter is an identifier, not
  // prose, wherever it appears.
  for (const match of new Set(narrative.match(OPAQUE_HEX_RUN_PATTERN) ?? [])) {
    if (asked(match)) continue;
    if (input.refs.some((ref) => ref.includes(match))) continue; // already reported exactly above
    findings.push({
      code: "ref_in_prose",
      token: match.slice(0, 24),
      fix: "Opaque references and record ids never belong in the narrative; describe the record in operator words (its register, date, or label) instead.",
    });
  }
  for (const namespace of input.namespaces) {
    if (asked(namespace)) continue;
    if (narrative.includes(namespace)) {
      findings.push({ code: "namespace_path", token: namespace, fix: "Name the information in the operator's words, not the capability path." });
    }
  }
  for (const name of new Set(input.fieldNames)) {
    if (!INTERNAL_NAME_PATTERN.test(name) || asked(name)) continue;
    if (wordPresent(narrative, name)) {
      const label = Object.hasOwn(input.lexicon.fieldLabels, name) ? input.lexicon.fieldLabels[name] : humanizeToken(name);
      findings.push({ code: "internal_field_name", token: name, fix: `Write "${label}" in plain words, not the field name "${name}".` });
    }
  }
  for (const literal of new Set(input.enumLiterals)) {
    if (asked(literal)) continue;
    if (wordPresent(narrative, literal)) {
      const label = Object.hasOwn(input.lexicon.enumLabels, literal) ? input.lexicon.enumLabels[literal] : humanizeToken(literal);
      findings.push({ code: "raw_enum_literal", token: literal, fix: `Write "${label}", not the internal value "${literal}".` });
    }
  }
  const grouping = new Intl.NumberFormat("en-US");
  const decimalGrouping = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const knownMajorDigits = new Set<string>();
  for (const money of input.moneyAmounts) {
    const units = money.amount / 100;
    knownMajorDigits.add(Math.abs(money.amount) % 100 !== 0 ? decimalGrouping.format(units) : grouping.format(units));
  }
  for (const money of input.moneyAmounts) {
    if (Math.abs(money.amount) < 10_000) continue; // below GH\u20b5100 plain integers collide with counts
    const display = formatMinorMoney(money.amount, money.currency);
    if (narrative.includes(display)) continue;
    const spellings = [grouping.format(money.amount), String(money.amount)];
    let echoed: string | undefined;
    for (const spelling of spellings) {
      if (!narrative.includes(spelling)) continue;
      const matcher = new RegExp(
        "(?:\\b(?:" + escapeRegExp(money.currency) + "|GHC)\\s*|GH\u20b5\\s*|(?<![\\d,.\\p{Sc}]))(?<![\\d,])" + escapeRegExp(spelling) + "(?!\\d|,\\d|\\.\\d)",
        "gu",
      );
      for (const match of narrative.matchAll(matcher)) {
        const digits = match[0].replace(/^[^0-9-]+/, "");
        if (!knownMajorDigits.has(digits)) {
          echoed = spelling;
          break;
        }
      }
      if (echoed) break;
    }
    if (echoed) {
      findings.push({
        code: "raw_minor_amount",
        token: echoed,
        fix: `${echoed} is a minor-unit amount; write ${display}.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Per-surface overlays (kernel-safe: pure data, string-keyed by profile id)
// ---------------------------------------------------------------------------

/** Daily Operations speaks the operations floor's language (docs/product-copy-tone.md). */
export const DAILY_OPERATIONS_TONE_LEXICON: AgentProductLexicon = {
  enumLabels: {
    close_blocked: "close blocked",
    daily_close: "daily close",
    operations_queue: "operations queue",
    in_stock: "in stock",
    auto_complete: "completed automatically",
    auto_start: "started automatically",
    "eod.auto_complete": "the automatic end-of-day close step",
    "eod.prepare": "the end-of-day preparation step",
    "opening.auto_start": "the automatic day-opening step",
  },
  namespaceLabels: {
    "reports.daySales": "the daily sales report",
    "reports.weekPerformance": "the weekly performance report",
    "reports.storePulse": "the store pulse report",
    "operations.storeDay": "the store day record",
    "operations.attention": "the attention list",
    "operations.approvals": "approvals",
    "operations.work": "open work",
    "cash.registerSessions": "the register drawers",
    "inventory.positions": "the live stock list",
    "automation.dailyOperations": "the daily operations automation",
    "inventory.replenishment": "replenishment recommendations",
    "operations.activity": "the activity feed",
  },
  fieldLabels: {
    registerSession: "drawer",
    registerSessions: "drawers",
    registerBlockerCount: "registers blocking the close",
    attentionCount: "items needing attention",
    openWorkItemCount: "open work items",
    lifecycleStage: "where the day stands",
    storeDay: "store day",
    stockState: "stock level",
    skuCode: "SKU",
    displayName: "item",
    observedAt: "as of",
    operatingDate: "store day",
    grossRevenue: "revenue",
    transactionCount: "number of sales",
    unitsSold: "units sold",
    stockValue: "stock value",
    unitCost: "unit cost",
  },
};

const SURFACE_LEXICON_OVERLAYS: { readonly [profileId: string]: AgentProductLexicon } = {
  daily_operations: DAILY_OPERATIONS_TONE_LEXICON,
};

/** The merged lexicon for a profile; an unknown profile gets the app lexicon unchanged. */
export function profileLexicon(profileId: string): AgentProductLexicon {
  const overlay = SURFACE_LEXICON_OVERLAYS[profileId];
  return overlay ? mergeLexicons(APP_PRODUCT_LEXICON, overlay) : APP_PRODUCT_LEXICON;
}
