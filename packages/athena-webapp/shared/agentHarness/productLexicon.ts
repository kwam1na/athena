/**
 * Product lexicon (kernel; runtime-neutral, browser-safe).
 *
 * The machine-readable projection of `docs/product-copy-tone.md` that the
 * harness enforces mechanically instead of by instruction:
 *
 * - `annotateMoneyDisplays` runs at the result boundary: every money-shaped
 *   value the model is shown carries a `display` string rendered by the same
 *   currency convention as the app (`GH₵14,149`, minor units only when
 *   non-zero), so quoting the right figure is the path of least resistance
 *   and the raw minor-unit integer never has to be interpreted.
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
  const candidate = value as { amount?: unknown; currency?: unknown };
  return (
    typeof candidate.amount === "number" &&
    Number.isInteger(candidate.amount) &&
    typeof candidate.currency === "string" &&
    /^[A-Za-z]{3}$/.test(candidate.currency)
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
// Narrative evidence harvest
// ---------------------------------------------------------------------------

export type AgentNarrativeEvidence = {
  readonly fieldNames: readonly string[];
  readonly enumLiterals: readonly string[];
  readonly moneyAmounts: readonly AgentMoneyAmount[];
};

const INTERNAL_NAME_PATTERN = /(?:[a-z0-9][A-Z]|_)/; // camelCase joint or snake_case
const ENUM_LITERAL_PATTERN = /^[a-z]+(?:_[a-z]+)+$/;

/** Harvest, from a model-visible result, the internal tokens prose must not echo. */
export function collectNarrativeEvidence(value: unknown): AgentNarrativeEvidence {
  const fieldNames = new Set<string>();
  const enumLiterals = new Set<string>();
  const moneyKeys = new Set<string>();
  const moneyAmounts: AgentMoneyAmount[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (depth > WALK_DEPTH_MAX || typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const record = node as { readonly [key: string]: unknown };
    if (isMoneyValue(record)) {
      const key = `${record.amount}:${record.currency.toUpperCase()}`;
      if (!moneyKeys.has(key)) {
        moneyKeys.add(key);
        moneyAmounts.push({ amount: record.amount, currency: record.currency.toUpperCase() });
      }
      return;
    }
    for (const [key, entry] of Object.entries(record)) {
      if (INTERNAL_NAME_PATTERN.test(key)) fieldNames.add(key);
      if (typeof entry === "string" && ENUM_LITERAL_PATTERN.test(entry)) enumLiterals.add(entry);
      walk(entry, depth + 1);
    }
  };
  walk(value, 0);
  return { fieldNames: [...fieldNames], enumLiterals: [...enumLiterals], moneyAmounts };
}

// ---------------------------------------------------------------------------
// Sources footer normalization
// ---------------------------------------------------------------------------

const FOOTER_HEADER = /\n+[ \t]*(?:sources?|citations?|refs?)[ \t]*:/gi;
const REF_TOKEN = /attempt_v\d|citation:v\d/;

/**
 * Strip a model-authored trailing "Sources:" footer. The answer surface
 * already renders the committed citations under "Sources", so a footer whose
 * lines are nothing but refs duplicates the UI in the wrong vocabulary — and
 * neither disclosure nor a corrective denial stopped the habit. Conservative
 * by construction: only a TRAILING section is considered, and only when every
 * non-empty line in it carries a ref token; a footer holding real prose, or a
 * sources mention mid-answer, is left exactly as written.
 */
export function stripSourcesFooter(narrative: string): string {
  let header: RegExpExecArray | null = null;
  FOOTER_HEADER.lastIndex = 0;
  for (let match = FOOTER_HEADER.exec(narrative); match; match = FOOTER_HEADER.exec(narrative)) header = match;
  if (!header) return narrative;
  const section = narrative.slice(header.index + header[0].length);
  const lines = section.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || !lines.every((line) => REF_TOKEN.test(line))) return narrative;
  return narrative.slice(0, header.index).trimEnd();
}

// ---------------------------------------------------------------------------
// Narrative normalization (the operatorMessages.ts idea, applied to the answer)
// ---------------------------------------------------------------------------

export type AgentNormalizeNarrativeOptions = {
  readonly evidence: Pick<AgentNarrativeEvidence, "fieldNames" | "enumLiterals" | "moneyAmounts">;
  readonly namespaces: readonly string[];
  readonly lexicon: AgentProductLexicon;
  readonly question: string;
};

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
  let text = narrative;
  const rewriteWord = (token: string, replacement: string) => {
    text = text.replace(new RegExp("\\b" + escapeRegExp(token) + "\\b", "g"), replacement);
  };
  // Rewrite what the run served the model AND what the lexicon itself names:
  // lexicon keys are curated-internal by construction, so a catalog-known
  // token the model used without reading it is still safely rewritable.
  for (const namespace of new Set([...options.namespaces, ...Object.keys(options.lexicon.namespaceLabels ?? {})])) {
    if (asked(namespace) || !text.includes(namespace)) continue;
    const label = options.lexicon.namespaceLabels?.[namespace] ?? humanizeToken(namespace.split(".")[1] ?? namespace);
    // Absorb a trailing verb mention ("reports.daySales.get") into the phrase.
    text = text.replace(new RegExp(`${escapeRegExp(namespace)}(?:\\.(?:get|list))?`, "g"), label);
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
    rewriteWord(literal, humanizeToken(literal));
  }
  const grouping = new Intl.NumberFormat("en-US");
  for (const money of options.evidence.moneyAmounts) {
    if (Math.abs(money.amount) < 10_000) continue; // below GH₵100, plain integers collide with counts
    const display = formatMinorMoney(money.amount, money.currency);
    for (const spelling of [grouping.format(money.amount), String(money.amount)]) {
      text = text.replace(
        new RegExp("(?:\\b(?:" + escapeRegExp(money.currency) + "|GHC)\\s*|GH\u20b5\\s*)?(?<![\\d,])" + escapeRegExp(spelling) + "(?!\\d)", "g"),
        display,
      );
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Tone sensor
// ---------------------------------------------------------------------------

export type AgentToneFindingCode =
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
  for (const namespace of input.namespaces) {
    if (asked(namespace)) continue;
    if (narrative.includes(namespace)) {
      findings.push({ code: "namespace_path", token: namespace, fix: "Name the information in the operator's words, not the capability path." });
    }
  }
  for (const name of new Set(input.fieldNames)) {
    if (!INTERNAL_NAME_PATTERN.test(name) || asked(name)) continue;
    if (wordPresent(narrative, name)) {
      const label = input.lexicon.fieldLabels[name] ?? humanizeToken(name);
      findings.push({ code: "internal_field_name", token: name, fix: `Write "${label}" in plain words, not the field name "${name}".` });
    }
  }
  for (const literal of new Set(input.enumLiterals)) {
    if (asked(literal)) continue;
    if (wordPresent(narrative, literal)) {
      const label = input.lexicon.enumLabels[literal] ?? humanizeToken(literal);
      findings.push({ code: "raw_enum_literal", token: literal, fix: `Write "${label}", not the internal value "${literal}".` });
    }
  }
  const grouping = new Intl.NumberFormat("en-US");
  for (const money of input.moneyAmounts) {
    if (Math.abs(money.amount) < 10_000) continue; // below GH₵100 plain integers collide with counts
    const display = formatMinorMoney(money.amount, money.currency);
    if (narrative.includes(display)) continue;
    const spellings = [grouping.format(money.amount), String(money.amount)];
    const echoed = spellings.find((spelling) => new RegExp(`(?<![\\d,])${escapeRegExp(spelling)}(?!\\d)`).test(narrative));
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
