import { describe, expect, it } from "vitest";

import {
  canOpenReplacementDrawerForLocalBlock,
  classifyRegisterOpenAgainstLifecycleBoundary,
  getRegisterSessionAuthoritativeCloseBoundary,
  canReuseCloudRegisterSessionForLocalOpen,
  canSupersedeReviewedRegisterSessionForLocalOpen,
  getRegisterSessionVoidApplicationStatus,
  getSaleBlockingDrawerAuthority,
  isNonBlockingRegisterLifecycleReviewEvent,
  isRegisterCloseoutReviewConflict,
  isRegisterSessionReplacementBlocking,
  isRegisterSessionSaleUsable,
  REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
} from "./registerSessionLifecyclePolicy";

describe("registerSessionLifecyclePolicy", () => {
  it("keeps only open and active register sessions sale usable", () => {
    expect(isRegisterSessionSaleUsable({ status: "open" })).toBe(true);
    expect(isRegisterSessionSaleUsable({ status: "active" })).toBe(true);
    expect(isRegisterSessionSaleUsable({ status: "closing" })).toBe(false);
    expect(isRegisterSessionSaleUsable({ status: "closeout_rejected" })).toBe(
      false,
    );
    expect(isRegisterSessionSaleUsable({ status: "closed" })).toBe(false);
    expect(isRegisterSessionSaleUsable({ status: "needs_review" })).toBe(false);
  });

  it("allows void application for open, active, and closing register sessions", () => {
    for (const status of ["open", "active", "closing"] as const) {
      expect(
        getRegisterSessionVoidApplicationStatus({
          registerSession: {
            status,
            storeId: "store-1",
            terminalId: "terminal-1",
          },
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ).toEqual({ allowed: true });
    }
  });

  it("blocks void application for closed and rejected closeout sessions", () => {
    for (const status of ["closeout_rejected", "closed"] as const) {
      expect(
        getRegisterSessionVoidApplicationStatus({
          registerSession: {
            status,
            storeId: "store-1",
            terminalId: "terminal-1",
          },
          storeId: "store-1",
          terminalId: "terminal-1",
        }),
      ).toEqual({ allowed: false, reason: "blocked_status" });
    }
  });

  it("distinguishes void application scope failures", () => {
    expect(
      getRegisterSessionVoidApplicationStatus({
        registerSession: null,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({ allowed: false, reason: "missing_session" });
    expect(
      getRegisterSessionVoidApplicationStatus({
        registerSession: {
          status: "closing",
          storeId: "store-2",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({ allowed: false, reason: "wrong_store" });
    expect(
      getRegisterSessionVoidApplicationStatus({
        registerSession: {
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-2",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({ allowed: false, reason: "wrong_terminal" });
  });

  it("allows replacement for submitted closeouts without making them sale usable", () => {
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: false,
        session: { status: "closing" },
      }),
    ).toBe(true);
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: true,
        session: { status: "closing" },
      }),
    ).toBe(false);
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: true,
        session: { status: "closeout_rejected" },
      }),
    ).toBe(false);
    expect(
      isRegisterSessionReplacementBlocking({
        hasSubmittedCloseout: true,
        session: { status: "active" },
      }),
    ).toBe(true);
  });

  it("treats same-drawer lifecycle rejection as recoverable for local sale blocking", () => {
    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: { localRegisterSessionId: "local-drawer-1" },
        drawerAuthority: {
          localRegisterSessionId: "local-drawer-1",
          status: "healthy",
        },
      }),
    ).toBeNull();

    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: { localRegisterSessionId: "local-drawer-1" },
        drawerAuthority: {
          localRegisterSessionId: "local-drawer-1",
          reason: "lifecycle_rejected",
          status: "blocked",
        },
      }),
    ).toBeNull();

    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: { localRegisterSessionId: "local-drawer-1" },
        drawerAuthority: {
          localRegisterSessionId: "local-drawer-1",
          reason: "cloud_closed",
          status: "blocked",
        },
      })?.reason,
    ).toBe("cloud_closed");
  });

  it("ignores drawer authority that belongs to a superseded drawer identity", () => {
    expect(
      getSaleBlockingDrawerAuthority({
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-drawer-2",
          localRegisterSessionId: "local-drawer-2",
        },
        drawerAuthority: {
          cloudRegisterSessionId: "cloud-drawer-1",
          localRegisterSessionId: "local-drawer-1",
          reason: "cloud_closed",
          status: "blocked",
        },
      }),
    ).toBeNull();
  });

  it("allows local replacement drawers only for cloud-closed, settled closeout, or submitted closeout blocks", () => {
    expect(
      canOpenReplacementDrawerForLocalBlock({
        drawerAuthorityReason: "cloud_closed",
        hasSettledCloseout: false,
        saleBlockReason: "drawer_authority",
      }),
    ).toBe(true);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        drawerAuthorityReason: "cloud_session_missing",
        hasSettledCloseout: false,
        saleBlockReason: "drawer_authority",
      }),
    ).toBe(true);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        drawerAuthorityReason: "authority_unknown",
        hasSettledCloseout: false,
        saleBlockReason: "drawer_authority",
      }),
    ).toBe(false);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        activeRegisterSession: { status: "closing" },
        hasSettledCloseout: false,
        saleBlockReason: "drawer_closed",
      }),
    ).toBe(true);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        hasSettledCloseout: true,
        saleBlockReason: "drawer_closed",
      }),
    ).toBe(true);
    expect(
      canOpenReplacementDrawerForLocalBlock({
        hasSettledCloseout: false,
        saleBlockReason: "terminal_integrity",
      }),
    ).toBe(false);
  });

  it("reuses cloud register sessions only for the same scoped sale-usable drawer identity", () => {
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "local-drawer-1",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: true,
        localRegisterSessionId: "local-drawer-1",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "local-drawer-1",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-2",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "local-drawer-2",
        registerSession: {
          localRegisterSessionId: "local-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canReuseCloudRegisterSessionForLocalOpen({
        hasOpenRegisterCloseoutReview: false,
        localRegisterSessionId: "cloud-drawer-1",
        registerSession: {
          cloudRegisterSessionId: "cloud-drawer-1",
          status: "active",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
  });

  it("allows superseding reviewed sale-usable or closing sessions only in scope", () => {
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: 20,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 30,
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: 50,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 10,
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: 20,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 30,
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        closeoutReviewBoundaryAt: null,
        hasOpenRegisterCloseoutReview: false,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        replacementOpenedAt: 20,
        registerSession: {
          localRegisterSessionId: "submitted-closeout-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closeout_rejected",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closed",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "reviewed-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(true);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-2",
          terminalId: "terminal-1",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
    expect(
      canSupersedeReviewedRegisterSessionForLocalOpen({
        allowUnknownCloseoutReviewBoundary: true,
        hasOpenRegisterCloseoutReview: true,
        replacementLocalRegisterSessionId: "replacement-local-drawer",
        registerSession: {
          localRegisterSessionId: "reviewed-local-drawer",
          status: "closing",
          storeId: "store-1",
          terminalId: "terminal-2",
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
  });

  it("classifies closeout review conflicts from the shared summary or money details", () => {
    expect(
      isRegisterCloseoutReviewConflict({
        summary: REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY,
      }),
    ).toBe(true);
    expect(
      isRegisterCloseoutReviewConflict({
        details: { countedCash: 100, expectedCash: 90, variance: 10 },
      }),
    ).toBe(true);
    expect(
      isRegisterCloseoutReviewConflict({
        summary: "Inventory needs manager review for a synced offline sale.",
      }),
    ).toBe(false);
  });

  it("keeps uploaded register lifecycle review events out of blocking sync status", () => {
    expect(
      isNonBlockingRegisterLifecycleReviewEvent({
        sync: { status: "needs_review" },
        type: "register.opened",
      }),
    ).toBe(true);
    expect(
      isNonBlockingRegisterLifecycleReviewEvent({
        sync: { status: "needs_review" },
        type: "cart.item_added",
      }),
    ).toBe(false);
  });

  it("derives the latest authoritative close boundary from lifecycle evidence", () => {
    expect(
      getRegisterSessionAuthoritativeCloseBoundary([
        { status: "closed", closedAt: 40, closeoutRecords: [] },
        { status: "closed", closeoutRecords: [{ occurredAt: 90 }], closedAt: 50 },
      ]),
    ).toEqual({ hasAmbiguousCloseEvidence: false, latestAuthoritativeCloseAt: 90 });
  });

  it("prefers closeout ownership over insertion order for the close boundary", () => {
    expect(
      getRegisterSessionAuthoritativeCloseBoundary([
        { status: "closing", closeoutOwnedAt: 30, closeoutRecords: [] },
      ]),
    ).toEqual({ hasAmbiguousCloseEvidence: false, latestAuthoritativeCloseAt: 30 });
  });

  it("marks a closed register session without close evidence ambiguous", () => {
    expect(
      getRegisterSessionAuthoritativeCloseBoundary([
        { status: "closed", closeoutRecords: [] },
      ]),
    ).toEqual({ hasAmbiguousCloseEvidence: true, latestAuthoritativeCloseAt: null });
  });

  it("reports no authoritative close boundary for a drawer that never closed", () => {
    expect(
      getRegisterSessionAuthoritativeCloseBoundary([
        { status: "active", closeoutRecords: [] },
        null,
        undefined,
      ]),
    ).toEqual({ hasAmbiguousCloseEvidence: false, latestAuthoritativeCloseAt: null });
  });

  it("classifies a register open before the authoritative close boundary as obsolete", () => {
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          latestAuthoritativeCloseAt: 90,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        candidate: {
          localRegisterSessionId: "local-register-2",
          occurredAt: 10,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({
      candidateOccurredAt: 10,
      disposition: "obsolete",
      latestAuthoritativeCloseAt: 90,
      reason: "at_or_before_authoritative_boundary",
    });
  });

  it("classifies a register open after the authoritative close boundary as fresh", () => {
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          latestAuthoritativeCloseAt: 90,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        candidate: {
          localRegisterSessionId: "local-register-2",
          occurredAt: 91,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({
      disposition: "fresh",
      reason: "after_authoritative_boundary",
    });
  });

  it("classifies an already projected register open as duplicate", () => {
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          latestAuthoritativeCloseAt: 90,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        candidate: {
          hasExistingProjection: true,
          localRegisterSessionId: "local-register-2",
          occurredAt: 10,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({ disposition: "duplicate", reason: "existing_projection" });
  });

  it("ignores lifecycle boundaries scoped to another terminal or store", () => {
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          latestAuthoritativeCloseAt: 90,
          storeId: "store-1",
          terminalId: "terminal-2",
        },
        candidate: {
          localRegisterSessionId: "local-register-2",
          occurredAt: 10,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({ disposition: "fresh", reason: "no_authoritative_boundary" });
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          latestAuthoritativeCloseAt: 90,
          storeId: "store-2",
          terminalId: "terminal-1",
        },
        candidate: {
          localRegisterSessionId: "local-register-2",
          occurredAt: 10,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({ disposition: "fresh", reason: "no_authoritative_boundary" });
  });

  it("fails closed when lifecycle chronology is missing or ambiguous", () => {
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          latestAuthoritativeCloseAt: 90,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        candidate: {
          localRegisterSessionId: "local-register-2",
          occurredAt: null,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({ disposition: "unsafe", reason: "missing_occurrence_evidence" });
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          hasAmbiguousCloseEvidence: true,
          latestAuthoritativeCloseAt: null,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        candidate: {
          localRegisterSessionId: "local-register-2",
          occurredAt: 10,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({ disposition: "unsafe", reason: "ambiguous_close_evidence" });
  });

  it("treats a drawer that never closed as a fresh register open", () => {
    expect(
      classifyRegisterOpenAgainstLifecycleBoundary({
        boundary: {
          latestAuthoritativeCloseAt: null,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        candidate: {
          localRegisterSessionId: "local-register-1",
          occurredAt: 10,
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      }),
    ).toEqual({ disposition: "fresh", reason: "no_authoritative_boundary" });
  });
});
