import { describe, expect, it } from "vitest";
import {
  buildEodAutomationDecisionEvidence,
  validateEodAutomationPolicyForSnapshot,
} from "./automationPolicy";

const cleanPolicy = {
  cleanDayAutoCompleteEnabled: true,
  maxAbsoluteCashVariance: 100,
  maxVoidedSaleCount: 2,
  maxVoidedSaleTotal: 1_000,
};

describe("daily close automation policy", () => {
  it("blocks unsupported review categories before automation completion", () => {
    const error = validateEodAutomationPolicyForSnapshot({
      policy: cleanPolicy,
      reviewedItemKeys: new Set(["inventory:1"]),
      snapshot: {
        blockers: [],
        carryForwardItems: [],
        readiness: {
          blockerCount: 0,
          carryForwardCount: 0,
          reviewCount: 1,
        },
        reviewItems: [
          {
            category: "inventory_adjustment",
            key: "inventory:1",
          },
        ],
        summary: {
          netCashVariance: 0,
          voidedTransactionCount: 0,
        },
      },
    });

    expect(error).toMatchObject({
      classification: "blocked",
      metadata: {
        disqualifyingCategories: ["inventory_adjustment"],
      },
    });
  });

  it("captures low-risk review evidence and schedule context", () => {
    const evidence = buildEodAutomationDecisionEvidence({
      automationScheduleEvidence: {
        closedAt: 200,
        evaluationAt: 250,
        openedAt: 100,
        scheduleVersion: "schedule.v1",
        source: "canonical_schedule",
        storeScheduleId: "schedule-1",
      },
      classification: "low_risk_review",
      eligible: true,
      policy: cleanPolicy,
      snapshot: {
        blockers: [],
        carryForwardItems: [{ category: "open_work", key: "work:1" }],
        readiness: {
          blockerCount: 0,
          carryForwardCount: 1,
          reviewCount: 1,
        },
        reviewItems: [
          {
            category: "voided_sale",
            key: "void:1",
            metadata: { total: 300 },
          },
        ],
        summary: {
          netCashVariance: -25,
          voidedTransactionCount: 1,
        },
      },
    });

    expect(evidence.observed).toMatchObject({
      absoluteCashVariance: 25,
      carryForwardItemKeys: ["work:1"],
      carryForwardPreserved: true,
      disqualifyingCategories: [],
      scheduleEvidenceSource: "canonical_schedule",
      scheduleVersion: "schedule.v1",
      storeScheduleId: "schedule-1",
      voidedSaleCount: 1,
      voidedSaleTotal: 300,
    });
  });
});
