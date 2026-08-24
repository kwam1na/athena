/**
 * Product lexicon: the machine-readable projection of docs/product-copy-tone.md
 * that the harness enforces mechanically — money display annotation at the
 * result boundary, and the completeRun tone sensor over the narrative.
 */
import { describe, expect, it } from "vitest";

import {
  annotateMoneyDisplays,
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

describe("mergeLexicons", () => {
  it("overlay enum labels win over the app lexicon", () => {
    const merged = mergeLexicons(APP_PRODUCT_LEXICON, {
      enumLabels: { close_blocked: "close is blocked" },
      fieldLabels: {},
    });
    expect(merged.enumLabels.close_blocked).toBe("close is blocked");
  });
});
