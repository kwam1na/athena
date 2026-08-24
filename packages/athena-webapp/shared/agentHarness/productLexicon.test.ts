/**
 * Product lexicon: the machine-readable projection of docs/product-copy-tone.md
 * that the harness enforces mechanically — money display annotation at the
 * result boundary, and the completeRun tone sensor over the narrative.
 */
import { describe, expect, it } from "vitest";

import {
  annotateMoneyDisplays,
  normalizeNarrative,
  stripSourcesFooter,
  APP_PRODUCT_LEXICON,
  collectNarrativeEvidence,
  formatMinorMoney,
  mergeLexicons,
  senseTone,
  type AgentToneSensorInput,
} from "./productLexicon";

describe("formatMinorMoney", () => {
  it("renders GHS with the GH₵ glyph, minor units only when non-zero", () => {
    expect(formatMinorMoney(1_414_900, "GHS")).toBe("GH₵14,149");
    expect(formatMinorMoney(750_000, "GHS")).toBe("GH₵7,500");
    expect(formatMinorMoney(123_456, "GHS")).toBe("GH₵1,234.56");
    expect(formatMinorMoney(0, "GHS")).toBe("GH₵0");
    expect(formatMinorMoney(-2_550, "GHS")).toBe("GH₵-25.50");
  });
});

describe("annotateMoneyDisplays", () => {
  it("injects display into money-shaped values anywhere in the tree", () => {
    const output = {
      grossRevenue: { state: "known", value: { amount: 1_414_900, currency: "GHS" } },
      paymentGroups: [{ method: "cash", amount: { amount: 750_000, currency: "GHS" } }],
      transactionCount: 4,
    };
    const annotated = annotateMoneyDisplays(output) as typeof output & Record<string, unknown>;
    expect((annotated.grossRevenue.value as Record<string, unknown>).display).toBe("GH₵14,149");
    expect((annotated.paymentGroups[0].amount as Record<string, unknown>).display).toBe("GH₵7,500");
    expect(annotated.transactionCount).toBe(4);
  });

  it("leaves non-money and already-annotated values alone", () => {
    const noise = { amount: "high", currency: 3, other: { amount: 5 } };
    expect(annotateMoneyDisplays(noise)).toEqual(noise);
    const pre = { amount: 100, currency: "GHS", display: "custom" };
    expect((annotateMoneyDisplays(pre) as Record<string, unknown>).display).toBe("custom");
  });
});

describe("collectNarrativeEvidence", () => {
  it("harvests internal field names, snake_case literals, and money amounts", () => {
    const evidence = collectNarrativeEvidence({
      grossRevenue: { state: "known", value: { amount: 1_414_900, currency: "GHS" } },
      lifecycleStage: "close_blocked",
      items: [{ skuCode: "6N2Y-JTG-9SM", stockState: "in_stock", quantity: 150 }],
    });
    expect(evidence.fieldNames).toContain("grossRevenue");
    expect(evidence.fieldNames).toContain("lifecycleStage");
    expect(evidence.fieldNames).not.toContain("items"); // plain-English single word
    expect(evidence.enumLiterals).toContain("close_blocked");
    expect(evidence.enumLiterals).toContain("in_stock");
    expect(evidence.enumLiterals).not.toContain("6N2Y-JTG-9SM");
    expect(evidence.moneyAmounts).toEqual([{ amount: 1_414_900, currency: "GHS" }]);
  });
});

const baseInput = (overrides: Partial<AgentToneSensorInput>): AgentToneSensorInput => ({
  narrative: "",
  question: "",
  fieldNames: [],
  enumLiterals: [],
  moneyAmounts: [],
  namespaces: [],
  refs: [],
  lexicon: APP_PRODUCT_LEXICON,
  ...overrides,
});

describe("senseTone", () => {
  it("passes a clean operator answer untouched", () => {
    const findings = senseTone(
      baseInput({
        narrative:
          "Sales so far today are GH₵14,149 across 4 sales. Register 06's drawer is still open with GH₵7,500 expected, and the close is blocked until it is counted.",
        fieldNames: ["grossRevenue", "lifecycleStage"],
        enumLiterals: ["close_blocked"],
        moneyAmounts: [{ amount: 1_414_900, currency: "GHS" }],
        namespaces: ["reports.daySales"],
        refs: ["attempt_v1.1.0123456789abcdef0123456789abcdef"],
      }),
    );
    expect(findings).toEqual([]);
  });

  it("flags backend field names echoed into prose, with the fix", () => {
    const findings = senseTone(
      baseInput({
        narrative: "operations.storeDay: lifecycleStage = close_blocked; registerBlockerCount = 1.",
        fieldNames: ["lifecycleStage", "registerBlockerCount"],
        enumLiterals: ["close_blocked"],
        namespaces: ["operations.storeDay"],
      }),
    );
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("internal_field_name");
    expect(codes).toContain("namespace_path");
    expect(codes).toContain("raw_enum_literal");
    const enumFinding = findings.find((finding) => finding.code === "raw_enum_literal");
    expect(enumFinding?.fix).toContain("close blocked");
  });

  it("waives tokens the operator asked with", () => {
    const findings = senseTone(
      baseInput({
        narrative: "SKU 6N2Y-JTG-9SM is out of stock; lifecycleStage is close_blocked.",
        question: "what is the lifecycleStage for sku 6N2Y-JTG-9SM?",
        fieldNames: ["lifecycleStage"],
        enumLiterals: ["close_blocked"],
      }),
    );
    expect(findings.map((finding) => finding.code)).toEqual(["raw_enum_literal"]);
  });

  it("flags raw minor-unit amounts and names the display value", () => {
    const findings = senseTone(
      baseInput({
        narrative: "Cash sales today: GHS 750,000.",
        moneyAmounts: [{ amount: 750_000, currency: "GHS" }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("raw_minor_amount");
    expect(findings[0].fix).toContain("GH₵7,500");
  });

  it("does not flag a money amount the narrative already displays correctly", () => {
    const findings = senseTone(
      baseInput({
        narrative: "Cash sales today: GH₵7,500.",
        moneyAmounts: [{ amount: 750_000, currency: "GHS" }],
      }),
    );
    expect(findings).toEqual([]);
  });

  it("flags refs pasted into prose", () => {
    const ref = "citation:v1.1.0.fedcba9876543210fedcba9876543210";
    const findings = senseTone(baseInput({ narrative: `Per ${ref}, sales are up.`, refs: [ref] }));
    expect(findings.map((finding) => finding.code)).toEqual(["ref_in_prose"]);
  });

  it("flags an opaque identifier from data even when its ref kind was rewritten", () => {
    // Observed on a driven turn: the lexicon's "register session" wording was
    // applied INSIDE a resource ref, so the exact-match loop missed it.
    const findings = senseTone(
      baseInput({
        narrative:
          "Largest variance: resource:register session.8d5c0a4d9a7e78365b5c876b9c4525d135c0bcbf9d0781dd.171d48524313ed1ecd38efe7 on register 07.",
      }),
    );
    expect(findings.map((finding) => finding.code)).toContain("ref_in_prose");
  });

  it("does not double-report a known ref, and leaves plain numbers alone", () => {
    const ref = "citation:v1.1.0.fedcba9876543210fedcba9876543210";
    const findings = senseTone(
      baseInput({ narrative: `Per ${ref}, 1234567890123456 units moved on 2026-08-24.`, refs: [ref] }),
    );
    expect(findings.map((finding) => finding.code)).toEqual(["ref_in_prose"]);
  });

  it("waives an opaque identifier the operator asked with", () => {
    const tail = "8d5c0a4d9a7e78365b5c876b9c4525d1";
    const findings = senseTone(
      baseInput({
        narrative: `Session ${tail} closed with no variance.`,
        question: `what happened to session ${tail}?`,
      }),
    );
    expect(findings).toEqual([]);
  });

  it("flags a stub narrative that reports the reads instead of answering", () => {
    for (const stub of [
      "Summary comparing this week to last, and items to watch today for Wigclub on 2026-08-23.",
      "Sales and store-day reads for 2026-08-23 were fetched. The daySales report and the storeDay lifecycle record were read.",
      "I read the store-day snapshot for Wigclub on 2026-08-23 and will report what this capability lets me do.",
    ]) {
      const findings = senseTone(baseInput({ narrative: stub }));
      expect(findings.map((finding) => finding.code)).toContain("stub_narrative");
    }
  });

  it("does not call a long complete answer a stub for mentioning a read in passing", () => {
    const narrative =
      "Sales so far today are GH₵14,149 across 4 sales, with cash GH₵7,500, card GH₵2,900 and mobile money GH₵3,749. " +
      "Register 06's drawer is still open with GH₵7,500 expected, and the close is blocked until it is counted. " +
      "Stock is healthy except two items running low; the full top-items list was read and the leaders are wigs and closures. " +
      "Nothing else needs attention right now.";
    expect(senseTone(baseInput({ narrative }))).toEqual([]);
  });

  it("does not call a short but complete answer a stub", () => {
    const findings = senseTone(baseInput({ narrative: "Register 06's drawer is the only one open." }));
    expect(findings).toEqual([]);
  });
});

describe("stripSourcesFooter", () => {
  it("removes a trailing sources footer whose lines are only refs and namespaces", () => {
    const narrative =
      "Register 06's drawer is still open with GH₵7,500 expected; the close is blocked until it is counted.\n\n" +
      "Sources:\n" +
      "- operations.storeDay get: citation:v1.1.1.185e44efd461484e67e3abb69f7c1c95\n" +
      "- cash.registerSessions list (partial): attempt_v1.1.3ec16115ab27d4eef7d3a4c9f43f4dd2";
    expect(stripSourcesFooter(narrative)).toBe(
      "Register 06's drawer is still open with GH₵7,500 expected; the close is blocked until it is counted.",
    );
  });

  it("strips a footer whose header carries a parenthetical", () => {
    const narrative =
      "Register 06's drawer is open.\n\nSources (reads used): the daily sales report (citation:v1.2.2.71d1f49fd468a77f3587803401921e2f), the register drawers (citation:v1.2.3.76b77b713cb472436037e48554f9164f)";
    expect(stripSourcesFooter(narrative)).toBe("Register 06's drawer is open.");
  });

  it("handles the singular Source: form and inline one-liners", () => {
    const narrative = "Cash sales today are GH₵7,500.\n\nSource: citation:v1.1.1.57010118cc3bd568cb90d8de85444906";
    expect(stripSourcesFooter(narrative)).toBe("Cash sales today are GH₵7,500.");
  });

  it("leaves a sources section carrying real prose alone", () => {
    const narrative =
      "Sales are GH₵14,149.\n\nSources:\n- The daily sales report, which also shows four sales and twenty units.";
    expect(stripSourcesFooter(narrative)).toBe(narrative);
  });

  it("never strips from the middle of an answer", () => {
    const narrative =
      "Sources: citation:v1.1.1.185e44efd461484e67e3abb69f7c1c95\n\nSales are GH₵14,149 and the close is blocked.";
    expect(stripSourcesFooter(narrative)).toBe(narrative);
  });

  it("leaves a narrative without a footer untouched", () => {
    expect(stripSourcesFooter("Sales are GH₵14,149.")).toBe("Sales are GH₵14,149.");
  });
});

describe("normalizeNarrative", () => {
  const lexicon = {
    enumLabels: { close_blocked: "close blocked" },
    fieldLabels: { lifecycleStage: "where the day stands", registerBlockerCount: "registers blocking the close" },
    namespaceLabels: { "reports.daySales": "the daily sales report", "inventory.positions": "the live stock list" },
  };
  const evidence = {
    fieldNames: ["lifecycleStage", "registerBlockerCount", "decisionReason"],
    enumLiterals: ["close_blocked", "operating_window_fallback"],
    moneyAmounts: [{ amount: 1_414_900, currency: "GHS" }],
  };

  it("rewrites harvested internal tokens to their operator wording", () => {
    const out = normalizeNarrative(
      "The lifecycleStage is close_blocked; registerBlockerCount is 1 per reports.daySales.",
      { evidence, namespaces: ["reports.daySales"], lexicon, question: "" },
    );
    expect(out).toBe("The lifecycle stage is close blocked; register blocker count is 1 per the daily sales report.");
  });

  it("scrubs the run's own refs from prose instead of leaving them for a denial", () => {
    const ref = "citation:v1.1.0.fedcba9876543210fedcba9876543210";
    const out = normalizeNarrative(`Per ${ref}, sales are up on register 07.`, {
      evidence,
      namespaces: [],
      lexicon,
      question: "",
      refs: [ref],
    });
    expect(out).toBe("Per the cited record, sales are up on register 07.");
  });

  it("scrubs ref-shaped identifiers from data, including the lexicon-mangled two-fragment form", () => {
    const intact = normalizeNarrative(
      "Session resource:register_session.8d5c0a4e832f3a3b4246c768c8596289.70561fce8f11265186d8b89f closed clean.",
      { evidence, namespaces: [], lexicon, question: "" },
    );
    expect(intact).toBe("Session the cited record closed clean.");
    // Observed on a driven turn: "register_session" rewritten to "register
    // session" INSIDE the ref, splitting it into two prose fragments.
    const mangled = normalizeNarrative(
      "Largest variance: resource:register session.8d5c0a4d9a7e78365b5c876b9c4525d1.171d48524313ed1ecd38efe7 on register 07.",
      { evidence, namespaces: [], lexicon, question: "" },
    );
    expect(mangled).toBe("Largest variance: the cited record on register 07.");
  });

  it("scrubs bare hex-tailed tokens but preserves an identifier the operator asked with", () => {
    const scrubbed = normalizeNarrative("Drawer 8d5c0a4d9a7e78365b5c876b9c4525d1 is still open.", {
      evidence,
      namespaces: [],
      lexicon,
      question: "",
    });
    expect(scrubbed).toBe("Drawer the cited record is still open.");
    const asked = normalizeNarrative("Drawer 8d5c0a4d9a7e78365b5c876b9c4525d1 is still open.", {
      evidence,
      namespaces: [],
      lexicon,
      question: "what happened to 8d5c0a4d9a7e78365b5c876b9c4525d1?",
    });
    expect(asked).toBe("Drawer 8d5c0a4d9a7e78365b5c876b9c4525d1 is still open.");
  });

  it("leaves nothing for the ref sensor after scrubbing", () => {
    const ref = "attempt_v1.1.d26722690726d41ac79be9f0b6690cd0";
    const out = normalizeNarrative(`Based on ${ref} and resource:closeout.aa11bb22cc33dd44ee55ff6677889900.deadbeefdeadbeefdeadbeef, all clear.`, {
      evidence,
      namespaces: [],
      lexicon,
      question: "",
      refs: [ref],
    });
    const findings = senseTone({
      narrative: out,
      question: "",
      fieldNames: [],
      enumLiterals: [],
      moneyAmounts: [],
      namespaces: [],
      refs: [ref],
      lexicon,
    });
    expect(findings.filter((finding) => finding.code === "ref_in_prose")).toEqual([]);
  });

  it("humanizes harvested tokens without lexicon entries", () => {
    const out = normalizeNarrative(
      "The decisionReason was operating_window_fallback.",
      { evidence, namespaces: [], lexicon, question: "" },
    );
    expect(out).toBe("The decision reason was operating window fallback.");
  });

  it("rewrites raw minor-unit amounts to the display value, absorbing a currency-code prefix", () => {
    const out = normalizeNarrative(
      "Revenue is GHS 1,414,900 so far.",
      { evidence, namespaces: [], lexicon, question: "" },
    );
    expect(out).toBe("Revenue is GH₵14,149 so far.");
    const bare = normalizeNarrative(
      "Revenue reached 1,414,900 today.",
      { evidence, namespaces: [], lexicon, question: "" },
    );
    expect(bare).toBe("Revenue reached GH₵14,149 today.");
  });

  it("leaves tokens the operator asked with untouched", () => {
    const out = normalizeNarrative(
      "The lifecycleStage is close blocked.",
      { evidence, namespaces: [], lexicon, question: "what is the lifecycleStage?" },
    );
    expect(out).toBe("The lifecycleStage is close blocked.");
  });

  it("rewrites lexicon-known tokens even when absent from the run's evidence", () => {
    const out = normalizeNarrative(
      "The registerBlockerCount comes from reports.daySales.",
      { evidence: { fieldNames: [], enumLiterals: [], moneyAmounts: [] }, namespaces: [], lexicon, question: "" },
    );
    expect(out).toBe("The register blocker count comes from the daily sales report.");
  });

  it("never rewrites tokens that were not in the run's evidence", () => {
    const out = normalizeNarrative(
      "The iPhone case and snake_oil are unrelated words.",
      { evidence, namespaces: [], lexicon, question: "" },
    );
    expect(out).toBe("The iPhone case and snake_oil are unrelated words.");
  });

  it("does not touch correctly displayed money", () => {
    const out = normalizeNarrative(
      "Revenue is GH₵14,149 so far.",
      { evidence, namespaces: [], lexicon, question: "" },
    );
    expect(out).toBe("Revenue is GH₵14,149 so far.");
  });
});

describe("review-round regressions", () => {
  const lexicon = {
    enumLabels: { "eod.auto_complete": "the automatic end-of-day close step" },
    fieldLabels: {},
    namespaceLabels: { "inventory.positions": "the live stock list", "inventory.positionsHistory": "the stock history" },
  };
  const noEvidence = { fieldNames: [], enumLiterals: [], moneyAmounts: [] };

  it("never rewrites a correct display when two amounts differ by 100x", () => {
    const evidence = { ...noEvidence, moneyAmounts: [
      { amount: 1_414_900, currency: "GHS" },
      { amount: 14_149, currency: "GHS" },
    ] };
    // A bare "14,149" here is AMBIGUOUS: the larger amount's correct major
    // figure and the smaller amount's raw minor echo share a spelling. The
    // adjudicated rule is conservative: never rewrite an ambiguous span —
    // corrupting a correct figure is strictly worse than letting a raw echo
    // through. The unambiguous corruption cases are covered below.
    const out = normalizeNarrative("Revenue is GH₵14,149 and the fee was 14,149.", { evidence, namespaces: [], lexicon, question: "" });
    expect(out).toBe("Revenue is GH₵14,149 and the fee was 14,149.");
    expect(normalizeNarrative(out, { evidence, namespaces: [], lexicon, question: "" })).toBe(out);
    const findings = senseTone({ narrative: "Revenue is GH₵14,149 so far.", question: "", fieldNames: [], enumLiterals: [], moneyAmounts: evidence.moneyAmounts, namespaces: [], refs: [], lexicon: APP_PRODUCT_LEXICON });
    expect(findings).toEqual([]);
  });

  it("never rewrites the head of a larger grouped number", () => {
    const evidence = { ...noEvidence, moneyAmounts: [{ amount: 1_414_900, currency: "GHS" }] };
    const text = "The population figure 1,414,900,000 is unrelated.";
    expect(normalizeNarrative(text, { evidence, namespaces: [], lexicon, question: "" })).toBe(text);
    const findings = senseTone({ narrative: text, question: "", fieldNames: [], enumLiterals: [], moneyAmounts: evidence.moneyAmounts, namespaces: [], refs: [], lexicon: APP_PRODUCT_LEXICON });
    expect(findings).toEqual([]);
  });

  it("keeps walking a flat row that merely contains amount and currency keys", () => {
    const evidence = collectNarrativeEvidence({ method: "mobile_money", amount: 750_000, currency: "GHS", providerFeeMinor: 1200 });
    expect(evidence.enumLiterals).toContain("mobile_money");
    expect(evidence.fieldNames).toContain("providerFeeMinor");
    expect(evidence.moneyAmounts).toEqual([{ amount: 750_000, currency: "GHS" }]); // harvested for policing, though never annotated
    const annotated = annotateMoneyDisplays({ method: "mobile_money", amount: 750_000, currency: "GHS", providerFeeMinor: 1200 }) as Record<string, unknown>;
    expect(annotated.display).toBeUndefined();
  });

  it("keeps a footer line that carries prose facts alongside a ref", () => {
    const narrative = "Register 06's drawer is open.\n\nSources:\n- attempt_v1.1.0123456789abcdef0123456789abcdef: drawer over by GH₵12 at close";
    expect(stripSourcesFooter(narrative)).toBe(narrative);
  });

  it("strips stacked refs-only footers to a fixpoint", () => {
    const narrative =
      "Sales are GH₵14,149.\n\nSources:\n- citation:v1.1.1.0123456789abcdef0123456789abcdef\n\nRefs:\n- attempt_v1.1.fedcba9876543210fedcba9876543210";
    expect(stripSourcesFooter(narrative)).toBe("Sales are GH₵14,149.");
  });

  it("leaves dotted lexicon keys alone instead of half-humanizing them", () => {
    const out = normalizeNarrative("The eod.auto_complete step ran.", { evidence: noEvidence, namespaces: [], lexicon, question: "" });
    expect(out).toBe("The eod.auto_complete step ran.");
  });

  it("does not rewrite a namespace inside a longer namespace and capitalizes at sentence start", () => {
    const out = normalizeNarrative(
      "inventory.positionsHistory holds the trend. inventory.positions was read.",
      { evidence: noEvidence, namespaces: ["inventory.positions", "inventory.positionsHistory"], lexicon, question: "" },
    );
    expect(out).toBe("The stock history holds the trend. The live stock list was read.");
  });
});

describe("round-2 regressions", () => {
  const lexicon = APP_PRODUCT_LEXICON;
  const pair = { fieldNames: [], enumLiterals: [], moneyAmounts: [
    { amount: 1_414_900, currency: "GHS" },
    { amount: 14_149, currency: "GHS" },
  ] };

  it("never corrupts a correct figure in any spelling (space, ISO code, bare)", () => {
    for (const text of ["Revenue is GH₵ 14,149 so far.", "Revenue is GHS 14,149 so far.", "Revenue reached 14,149 cedis."]) {
      expect(normalizeNarrative(text, { evidence: pair, namespaces: [], lexicon, question: "" })).toBe(text);
      expect(senseTone({ narrative: text, question: "", fieldNames: [], enumLiterals: [], moneyAmounts: pair.moneyAmounts, namespaces: [], refs: [], lexicon })).toEqual([]);
    }
  });

  it("is idempotent for non-GHS currencies (the inserted display is never re-matched bare)", () => {
    const usd = { fieldNames: [], enumLiterals: [], moneyAmounts: [
      { amount: 1_414_900, currency: "USD" },
      { amount: 14_149, currency: "USD" },
    ] };
    const once = normalizeNarrative("Total was 1414900 exactly.", { evidence: usd, namespaces: [], lexicon, question: "" });
    expect(once).toBe("Total was $14,149 exactly.");
    expect(normalizeNarrative(once, { evidence: usd, namespaces: [], lexicon, question: "" })).toBe(once);
  });

  it("still rewrites and senses a glyph-prefixed raw minor echo (no space)", () => {
    const evidence = { fieldNames: [], enumLiterals: [], moneyAmounts: [{ amount: 1_414_900, currency: "GHS" }] };
    for (const text of ["GH₵1414900 total", "GH₵1,414,900 total"]) {
      expect(normalizeNarrative(text, { evidence, namespaces: [], lexicon, question: "" })).toBe("GH₵14,149 total");
    }
    const findings = senseTone({ narrative: "GH₵1,414,900 total", question: "", fieldNames: [], enumLiterals: [], moneyAmounts: evidence.moneyAmounts, namespaces: [], refs: [], lexicon });
    expect(findings.map((finding) => finding.code)).toEqual(["raw_minor_amount"]);
  });

  it("never rewrites the head of a decimal number", () => {
    const text = "The reading 14,149.50 units.";
    expect(normalizeNarrative(text, { evidence: pair, namespaces: [], lexicon, question: "" })).toBe(text);
  });

  it("keeps a footer line whose label is a factual clause, even digit-free", () => {
    const narrative = "Answer here.\n\nSources:\n- attempt_v1.1.0123456789abcdef0123456789abcdef: drawer left open overnight, manager paged";
    expect(stripSourcesFooter(narrative)).toBe(narrative);
  });

  it("never strips a footer-only narrative with a leading newline to empty", () => {
    const narrative = "\nSources:\n- attempt_v1.1.0123456789abcdef0123456789abcdef";
    expect(stripSourcesFooter(narrative)).toBe(narrative);
  });

  it("does not capitalize a namespace label after an abbreviation", () => {
    const out = normalizeNarrative("Check stock, e.g. inventory.positions, before close.", {
      evidence: { fieldNames: [], enumLiterals: [], moneyAmounts: [] },
      namespaces: ["inventory.positions"],
      lexicon: { enumLabels: {}, fieldLabels: {}, namespaceLabels: { "inventory.positions": "the live stock list" } },
      question: "",
    });
    expect(out).toBe("Check stock, e.g. the live stock list, before close.");
  });

  it("reports truncation when a harvest cap is hit", () => {
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 260; index++) wide[`fieldName${index}A`] = index;
    const evidence = collectNarrativeEvidence(wide);
    expect(evidence.fieldNames.length).toBe(200);
    expect(evidence.truncated).toBe(true);
    expect(collectNarrativeEvidence({ plainField: 1 }).truncated).toBe(false);
  });
});

describe("mergeLexicons", () => {
  it("overlay enum labels win over the app lexicon", () => {
    const merged = mergeLexicons(APP_PRODUCT_LEXICON, {
      enumLabels: { close_blocked: "close is blocked" },
      fieldLabels: {},
    });
    expect(merged.enumLabels.close_blocked).toBe("close is blocked");
  });
});
