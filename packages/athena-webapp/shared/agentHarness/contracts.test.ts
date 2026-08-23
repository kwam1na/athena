/**
 * Capability SDK contract tests, including the ticket's type-level
 * assertions. Everything here runs against the browser-safe
 * contract modules only; no Convex, no product domain.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

import { budgetVector } from "./execution";
import {
  AGENT_COMMAND_NAMESPACE_RESERVATION,
  AGENT_HARNESS_CONTRACT_VERSION,
  AGENT_READ_VERBS,
  AGENT_RESERVED_COMMAND_VERBS,
  AgentVersionedExtensionError,
  isOpaqueRef,
  isRawIdentifierFieldName,
  looksLikeRawDocumentId,
  maxEgressClass,
  opaqueRef,
  parseOpaqueRef,
  versionedExtensionRequired,
  type AgentReservedCommandNamespace,
  type OpaqueRef,
} from "./values";
import {
  deriveCompleteness,
  known,
  partial,
  scanForRawIdentifiers,
  stale,
  unavailable,
  unknown,
  validateReadEnvelope,
  type AgentGetEnvelope,
  type AgentListEnvelope,
  type AgentValueState,
} from "./results";
import {
  composeCapabilityPackages,
  defineCapabilityManifest,
  omitUngrantedFields,
  projectManifestForGrant,
  summarizeCapability,
  validateCapabilityManifest,
  type AgentCapabilityManifest,
  type FullShape,
  type ProjectedShape,
} from "./manifest";
import {
  AGENT_NARRATIVE_POLICIES,
  assertProfileSelection,
  defineAgentProfile,
  definePresentationAdapter,
  validateProfileDefinition,
} from "./profile";
import {
  defineAgentReadPort,
  validateReadPortDefinition,
  validateReadPortIndex,
} from "./readPort";
import {
  AGENT_FIXED_TOOL_IDS,
  type AgentCapabilityOutcome,
  type AgentFacade,
  type AgentResourceFacade,
} from "./bridge";
import { DAILY_OPERATIONS_MATRIX_FIXTURE } from "./dailyOperationsMatrix.fixture";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const storeDayManifest = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_fixture_storeday",
  namespace: { package: "operations", resource: "storeDay" },
  packageVersion: "1.0.0",
  purpose: "One semantic store-day snapshot: lifecycle, readiness, close state.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    get: {
      purpose: "Read the store-day snapshot for one operating date.",
      filters: {
        operatingDate: {
          kind: "operatingDate",
          required: true,
          meaning: "Operating date resolved by server-side store time.",
        },
      },
      bounds: { kind: "snapshot" },
    },
  },
  result: {
    fields: {
      operatingDate: { kind: "operatingDate", meaning: "Operating date of the snapshot." },
      lifecycleStage: {
        kind: "enum",
        values: ["not_opened", "open", "closing", "closed"],
        meaning: "Store-day lifecycle stage.",
      },
      readiness: {
        kind: "object",
        meaning: "Opening readiness summary.",
        fields: {
          registersOpen: { kind: "integer", meaning: "Registers currently open." },
          blockers: {
            kind: "array",
            meaning: "Open readiness blockers.",
            maxItems: 20,
            items: { kind: "string", meaning: "Blocker label." },
          },
        },
      },
      closeRecordRef: {
        kind: "opaqueRef",
        refKind: "source",
        optional: true,
        meaning: "Accepted close record, when one exists.",
      },
      reviewEvidence: {
        kind: "text",
        meaning: "Manager review evidence.",
        projection: "managerReview",
        valueState: true,
      },
    },
  },
  projections: {
    managerReview: {
      requires: { tier: "full_admin" },
      egressClass: "sensitive",
      meaning: "Manager review evidence, full admins only.",
    },
  },
  freshness: {
    classes: ["live", "accepted"],
    authority: "authoritative_record",
    rule: "Live for the current day; accepted close/open records are authoritative for history.",
  },
  completeness: {
    rule: "Conjunction of lifecycle coverage and close-source coverage.",
    sourceKeys: ["lifecycle", "closeRecords"],
  },
  citation: {
    rule: "Cite source record versions plus capture time.",
    sourceRefKinds: ["store_day_record", "close_record"],
  },
  evidence: {
    mode: "extractor",
    extractorKey: "operations.storeDay.claims",
    extractorVersion: "1",
    claimShapes: ["lifecycleStage", "readiness"],
  },
  cost: {
    worstCasePerCall: budgetVector({ calls: 1, rows: 1, bytes: 16_384, costUnits: 2, elapsedMs: 1_500 }),
  },
  egressClass: "operational",
  examples: [
    {
      title: "Today's store day",
      verb: "get",
      args: { operatingDate: "2026-08-21" },
      description: "Fetch the current operating day.",
    },
  ],
  binding: {
    readIntents: ["daily_operations.view", "daily_close.view"],
    portKey: "operations.storeDay.get",
    implementationVersion: "1",
  },
});

const attentionManifest = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_fixture_attention",
  namespace: { package: "operations", resource: "attention" },
  packageVersion: "1.0.0",
  purpose: "Attention items that need an operator today.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page through attention items for one operating date.",
      filters: {
        operatingDate: { kind: "operatingDate", required: true, meaning: "Operating date." },
        status: {
          kind: "enum",
          required: false,
          values: ["open", "resolved"],
          meaning: "Item status.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 2 },
    },
  },
  result: {
    fields: {
      itemRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque attention item ref." },
      title: { kind: "string", meaning: "Item title." },
      lane: { kind: "string", meaning: "Contributing lane." },
      reason: {
        kind: "text",
        meaning: "Manager-only reason.",
        projection: "managerReasons",
      },
    },
  },
  projections: {
    managerReasons: {
      requires: { tier: "manager" },
      egressClass: "sensitive",
      meaning: "Manager-only reasons and evidence.",
    },
  },
  freshness: { classes: ["live"], authority: "live_read", rule: "Live queue snapshot." },
  completeness: {
    rule: "Derived from every contributing lane and page.",
    sourceKeys: ["lanes", "pages"],
  },
  citation: { rule: "Cite work/approval refs and capture time.", sourceRefKinds: ["work_item"] },
  evidence: { mode: "provenance_only", reason: "Queue rows are transient." },
  cost: {
    worstCasePerCall: budgetVector({ calls: 1, rows: 100, bytes: 65_536, costUnits: 3, elapsedMs: 2_000 }),
  },
  egressClass: "operational",
  examples: [
    {
      title: "Open items",
      verb: "list",
      args: { operatingDate: "2026-08-21", status: "open" },
      description: "First page of open items.",
    },
  ],
  binding: {
    readIntents: ["daily_operations.view", "operations.workItems.view"],
    portKey: "operations.attention.list",
    implementationVersion: "1",
  },
});

const inventoryPositionsManifest = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_fixture_inventory_positions",
  namespace: { package: "inventory", resource: "positions" },
  packageVersion: "2.1.0",
  purpose: "Live stock positions per SKU.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page through stock positions.",
      filters: {
        stockState: {
          kind: "enum",
          required: false,
          values: ["in_stock", "low", "out"],
          meaning: "Stock state partition.",
        },
      },
      bounds: { kind: "collection", maxItemsPerPage: 100, maxPagesPerRun: 3 },
    },
    get: {
      purpose: "Read one SKU position.",
      filters: {
        skuRef: { kind: "opaqueRef", refKind: "resource", required: true, meaning: "Opaque SKU ref." },
      },
      bounds: { kind: "snapshot" },
    },
  },
  result: {
    fields: {
      skuRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque SKU ref." },
      onHand: { kind: "quantity", meaning: "Units on hand." },
      unitCost: { kind: "money", meaning: "Unit cost.", projection: "costOverlay" },
    },
  },
  projections: {
    costOverlay: {
      requires: { tier: "member", readIntents: ["inventory.cost_overlay.view"] },
      egressClass: "sensitive",
      meaning: "Unit cost and value.",
    },
  },
  freshness: { classes: ["live"], authority: "live_read", rule: "Live stock position." },
  completeness: { rule: "Page exhaustion determines completeness.", sourceKeys: ["positions"] },
  citation: { rule: "Cite SKU snapshot hashes and capture time.", sourceRefKinds: ["sku_snapshot"] },
  evidence: {
    mode: "extractor",
    extractorKey: "inventory.positions.claims",
    extractorVersion: "1",
    claimShapes: ["onHand"],
  },
  cost: {
    worstCasePerCall: budgetVector({ calls: 1, rows: 100, bytes: 65_536, costUnits: 3, elapsedMs: 2_000 }),
  },
  egressClass: "operational",
  examples: [
    {
      title: "Low stock",
      verb: "list",
      args: { stockState: "low" },
      description: "Low-stock positions.",
    },
  ],
  binding: {
    readIntents: ["inventory.stock.view"],
    portKey: "inventory.positions",
    implementationVersion: "3",
  },
});

function issueCodes(result: { ok: boolean; issues?: readonly { code: string }[] }) {
  return result.ok ? [] : (result.issues ?? []).map((issue) => issue.code);
}

// ---------------------------------------------------------------------------
// Canonical values
// ---------------------------------------------------------------------------

describe("canonical values", () => {
  it("mints and parses opaque refs without exposing raw identifiers", () => {
    const ref = opaqueRef("source", "store_day:2026-08-21:v3");
    expect(parseOpaqueRef(ref)).toEqual({ kind: "source", token: "store_day:2026-08-21:v3" });
    expect(() => opaqueRef("source", "k17c5k2q0p3gxz7b3w4h5v6n7m8d9e0f")).toThrow(
      /raw document id/i,
    );
  });

  it("rejects a bare string where a minted opaque ref is required", () => {
    // The phantom brand is required, so only the minting path (or a narrowing
    // through isOpaqueRef) produces a value the checker accepts.
    expectTypeOf<string>().not.toMatchTypeOf<OpaqueRef<"source">>();
    expectTypeOf<OpaqueRef<"source">>().toMatchTypeOf<string>();
    expectTypeOf(opaqueRef("source", "store_day:2026-08-21")).toEqualTypeOf<OpaqueRef<"source">>();
    expectTypeOf<OpaqueRef<"resource">>().not.toMatchTypeOf<OpaqueRef<"source">>();

    const serialized: string = opaqueRef("source", "store_day:2026-08-21");
    expect(isOpaqueRef(serialized, "source")).toBe(true);
    if (isOpaqueRef(serialized, "source")) {
      expectTypeOf(serialized).toMatchTypeOf<OpaqueRef<"source">>();
    }
    expect(isOpaqueRef("store_day:2026-08-21", "source")).toBe(false);
  });

  it("recognises raw document ids and id-shaped field names", () => {
    expect(looksLikeRawDocumentId("k17c5k2q0p3gxz7b3w4h5v6n7m8d9e0f")).toBe(true);
    expect(looksLikeRawDocumentId("2026-08-21")).toBe(false);
    expect(isRawIdentifierFieldName("_id")).toBe(true);
    expect(isRawIdentifierFieldName("storeId")).toBe(true);
    expect(isRawIdentifierFieldName("_creationTime")).toBe(true);
    expect(isRawIdentifierFieldName("skuRef")).toBe(false);
  });

  it("orders egress classes and takes the maximum", () => {
    expect(maxEgressClass("operational", "sensitive", "operational")).toBe("sensitive");
    expect(maxEgressClass("restricted", "sensitive")).toBe("restricted");
    expect(maxEgressClass()).toBe("operational");
  });

  it("reserves the command namespace as a non-executable marker", () => {
    expect(AGENT_COMMAND_NAMESPACE_RESERVATION.executable).toBe(false);
    expect(Object.isFrozen(AGENT_COMMAND_NAMESPACE_RESERVATION)).toBe(true);
    expect(AGENT_READ_VERBS).toEqual(["get", "list"]);
    for (const verb of AGENT_RESERVED_COMMAND_VERBS) {
      expect(AGENT_READ_VERBS).not.toContain(verb);
    }
    expectTypeOf<AgentReservedCommandNamespace["executable"]>().toEqualTypeOf<false>();
    expectTypeOf<AgentReservedCommandNamespace>().not.toHaveProperty("execute");
  });

  it("produces a versioned-extension error for primitives outside v1", () => {
    const issue = versionedExtensionRequired("scope.kind", "region");
    expect(issue.code).toBe("versioned_extension_required");
    expect(issue.contractVersion).toBe(AGENT_HARNESS_CONTRACT_VERSION);
    expect(issue.message).toMatch(/versioned contract evolution/i);
    const error = new AgentVersionedExtensionError(issue);
    expect(error.issue.primitive).toBe("scope.kind");
  });
});

// ---------------------------------------------------------------------------
// Result semantics (scenario 3)
// ---------------------------------------------------------------------------

describe("result semantics", () => {
  it("keeps unknown, unavailable, stale, and partial as distinct typed states", () => {
    const states: AgentValueState<number>[] = [
      known(4),
      unknown("not_recorded"),
      unavailable("upstream timeout", { retryable: true }),
      stale(3, { asOf: 1_000, staleAfter: 2_000 }),
      partial(2, { missing: ["registers"] }),
    ];
    expect(states.map((state) => state.state)).toEqual([
      "known",
      "unknown",
      "unavailable",
      "stale",
      "partial",
    ]);
    expectTypeOf<AgentValueState<number>["state"]>().toEqualTypeOf<
      "known" | "unknown" | "unavailable" | "stale" | "partial"
    >();
    // Unauthorized is never a value state: it is structural absence.
    // @ts-expect-error unauthorized is not a value state
    const notAState: AgentValueState<number> = { state: "unauthorized" };
    expect(notAState).toBeDefined();
  });

  it("derives completeness as the minimum across sources and never overstates", () => {
    expect(deriveCompleteness([]).status).toBe("partial");
    expect(
      deriveCompleteness([
        { sourceKey: "lifecycle", status: "complete" },
        { sourceKey: "closeRecords", status: "complete" },
      ]).status,
    ).toBe("complete");
    const mixed = deriveCompleteness([
      { sourceKey: "lifecycle", status: "complete" },
      { sourceKey: "pages", status: "truncated", missing: ["page 3"] },
    ]);
    expect(mixed.status).toBe("partial");
    expect(mixed.sources).toHaveLength(2);
  });

  it("validates the uniform envelope and rejects raw identifiers anywhere in data", () => {
    const envelope: AgentGetEnvelope<{ operatingDate: string; nested: { ref: string } }> = {
      contractVersion: 1,
      capabilityId: storeDayManifest.capabilityId,
      namespace: "operations.storeDay",
      verb: "get",
      data: { operatingDate: "2026-08-21", nested: { ref: opaqueRef("source", "x") } },
      observedAt: 1_000,
      capturedAt: 1_000,
      freshness: {
        class: "live",
        authority: "live_read",
        observedAt: 1_000,
        capturedAt: 1_000,
      },
      completeness: deriveCompleteness([{ sourceKey: "lifecycle", status: "complete" }]),
      warnings: [],
      sourceRefs: [{ ref: opaqueRef("source", "x"), kind: "store_day_record", capturedAt: 1_000 }],
    };
    expect(validateReadEnvelope(envelope).ok).toBe(true);

    const leaking = {
      ...envelope,
      data: { operatingDate: "2026-08-21", storeId: "k17c5k2q0p3gxz7b3w4h5v6n7m8d9e0f" },
    };
    expect(scanForRawIdentifiers(leaking.data)).toEqual([
      "storeId (field name)",
      "storeId (value)",
    ]);
    expect(issueCodes(validateReadEnvelope(leaking))).toContain("raw_identifier_in_result");

    const list: AgentListEnvelope<{ itemRef: string }> = {
      ...envelope,
      verb: "list",
      data: [{ itemRef: opaqueRef("resource", "a") }],
      pagination: { hasMore: false, pageIndex: 0, pageSize: 100, pagesRemainingInRun: 1 },
    };
    expect(validateReadEnvelope(list).ok).toBe(true);
    const withoutPagination = Object.fromEntries(Object.entries(list).filter(([key]) => key !== "pagination"));
    expect(issueCodes(validateReadEnvelope(withoutPagination))).toContain("pagination_missing");
  });
});

// ---------------------------------------------------------------------------
// Manifest contract (scenarios 1 and 2)
// ---------------------------------------------------------------------------

describe("capability manifest contract", () => {
  it("accepts a complete manifest", () => {
    expect(validateCapabilityManifest(storeDayManifest)).toEqual({ ok: true, manifest: storeDayManifest });
  });

  it("composes two authorized packages into one collision-free SDK view", () => {
    const composed = composeCapabilityPackages([
      storeDayManifest,
      attentionManifest,
      inventoryPositionsManifest,
    ]);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(Object.keys(composed.view.packages).sort()).toEqual(["inventory", "operations"]);
    expect(composed.view.packages.operations.resources.storeDay).toEqual({
      capabilityId: "cap_fixture_storeday",
      verbs: ["get"],
      scopeKind: "store",
    });
    expect(composed.view.packages.inventory.resources.positions.verbs).toEqual(["get", "list"]);
    expect(composed.view.packages.inventory.version).toBe("2.1.0");
  });

  it("rejects namespace collisions and duplicate capability ids", () => {
    const clash = defineCapabilityManifest({
      ...storeDayManifest,
      capabilityId: "cap_fixture_storeday_clone",
    });
    expect(issueCodes(composeCapabilityPackages([storeDayManifest, clash]))).toEqual([
      "namespace_collision",
    ]);
    const duplicateId = defineCapabilityManifest({
      ...attentionManifest,
      capabilityId: storeDayManifest.capabilityId,
    });
    expect(issueCodes(composeCapabilityPackages([storeDayManifest, duplicateId]))).toEqual([
      "capability_id_collision",
    ]);
    const versionDrift = defineCapabilityManifest({ ...attentionManifest, packageVersion: "1.1.0" });
    expect(issueCodes(composeCapabilityPackages([storeDayManifest, versionDrift]))).toEqual([
      "package_version_conflict",
    ]);
  });

  it("rejects raw identifiers in results, filters, and examples", () => {
    const withRawId = {
      ...storeDayManifest,
      result: {
        fields: {
          ...storeDayManifest.result.fields,
          storeId: { kind: "string", meaning: "Raw store id." },
        },
      },
    } as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(withRawId))).toContain("raw_identifier_field");
    const withRawExample = {
      ...storeDayManifest,
      examples: [
        {
          title: "Bad",
          verb: "get",
          args: { operatingDate: "k17c5k2q0p3gxz7b3w4h5v6n7m8d9e0f" },
          description: "Leaks an id.",
        },
      ],
    } as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(withRawExample))).toContain("raw_identifier_in_example");
  });

  it("rejects unsupported verbs as versioned extensions and reserved command verbs outright", () => {
    const searchVerb = {
      ...storeDayManifest,
      operations: {
        ...storeDayManifest.operations,
        search: { purpose: "x", filters: {}, bounds: { kind: "collection", maxItemsPerPage: 10, maxPagesPerRun: 1 } },
      },
    } as unknown as AgentCapabilityManifest;
    const searchResult = validateCapabilityManifest(searchVerb);
    expect(issueCodes(searchResult)).toContain("versioned_extension_required");
    if (!searchResult.ok) {
      expect(searchResult.issues.find((issue) => issue.code === "versioned_extension_required")).toMatchObject({
        primitive: "operation.verb",
        value: "search",
      });
    }
    const proposeVerb = {
      ...storeDayManifest,
      operations: { ...storeDayManifest.operations, propose: { purpose: "x", filters: {}, bounds: { kind: "snapshot" } } },
    } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(proposeVerb))).toContain("reserved_command_verb");
  });

  it("rejects missing bounds and agent-uncallable filter kinds", () => {
    const noBounds = {
      ...attentionManifest,
      operations: {
        list: { ...attentionManifest.operations.list, bounds: undefined },
      },
    } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(noBounds))).toContain("bounds_missing");
    const overBounds = {
      ...attentionManifest,
      operations: {
        list: {
          ...attentionManifest.operations.list,
          bounds: { kind: "collection", maxItemsPerPage: 0, maxPagesPerRun: 2 },
        },
      },
    } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(overBounds))).toContain("bounds_invalid");
    const rawWindow = {
      ...attentionManifest,
      operations: {
        list: {
          ...attentionManifest.operations.list,
          filters: {
            ...attentionManifest.operations.list.filters,
            utcOffset: { kind: "timezone", required: false, meaning: "Client offset." },
            since: { kind: "timestamp", required: false, meaning: "Raw window start." },
          },
        },
      },
    } as unknown as AgentCapabilityManifest;
    const codes = issueCodes(validateCapabilityManifest(rawWindow));
    expect(codes.filter((code) => code === "filter_kind_not_agent_callable")).toHaveLength(2);
  });

  it("rejects incomplete metadata, undeclared projections, and invalid examples", () => {
    const incomplete = {
      ...storeDayManifest,
      purpose: "",
      examples: [],
      citation: { rule: "", sourceRefKinds: [] },
      completeness: { rule: "x", sourceKeys: [] },
      binding: { readIntents: [], portKey: "", implementationVersion: "" },
    } as unknown as AgentCapabilityManifest;
    const codes = issueCodes(validateCapabilityManifest(incomplete));
    expect(codes).toContain("metadata_incomplete");
    expect(codes.filter((code) => code === "metadata_incomplete").length).toBeGreaterThanOrEqual(5);

    const undeclaredProjection = {
      ...storeDayManifest,
      projections: {},
    } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(undeclaredProjection))).toContain("projection_undeclared");

    const badExample = {
      ...storeDayManifest,
      examples: [{ title: "Wrong verb", verb: "list", args: {}, description: "" }],
    } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(badExample))).toContain("example_invalid");

    const costTooLow = {
      ...attentionManifest,
      cost: { worstCasePerCall: budgetVector({ calls: 1, rows: 10, bytes: 10, costUnits: 1, elapsedMs: 1 }) },
    } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(costTooLow))).toContain("cost_below_bounds");
  });

  it("rejects scope kinds, lifecycle states, and field kinds outside the v1 vocabulary", () => {
    const regionScope = { ...storeDayManifest, scope: { kind: "region" } } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(regionScope))).toContain("versioned_extension_required");
    const canary = { ...storeDayManifest, lifecycle: "canary" } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(canary))).toContain("versioned_extension_required");
    const geo = {
      ...storeDayManifest,
      result: { fields: { where: { kind: "geopoint", meaning: "x" } } },
    } as unknown as AgentCapabilityManifest;
    expect(issueCodes(validateCapabilityManifest(geo))).toContain("versioned_extension_required");
  });

  it("projects declarations for a grant: unauthorized projections, fields, and examples are absent", () => {
    const full = projectManifestForGrant(storeDayManifest, {
      grantedProjections: ["managerReview"],
    });
    expect(Object.keys(full.result.fields)).toContain("reviewEvidence");
    expect(Object.keys(full.projections)).toEqual(["managerReview"]);

    const restricted = projectManifestForGrant(storeDayManifest, { grantedProjections: [] });
    expect(Object.keys(restricted.result.fields)).not.toContain("reviewEvidence");
    expect(restricted.projections).toEqual({});
    expect(JSON.stringify(restricted)).not.toContain("managerReview");

    const withSensitiveExample = defineCapabilityManifest({
      ...storeDayManifest,
      examples: [
        ...storeDayManifest.examples,
        {
          title: "Review evidence",
          verb: "get",
          args: { operatingDate: "2026-08-21" },
          description: "Includes manager review.",
          usesProjections: ["managerReview"],
        },
      ],
    });
    expect(projectManifestForGrant(withSensitiveExample, { grantedProjections: [] }).examples).toHaveLength(1);

    const summary = summarizeCapability(storeDayManifest);
    expect(summary).toMatchObject({
      capabilityId: "cap_fixture_storeday",
      namespace: "operations.storeDay",
      purpose: storeDayManifest.purpose,
      verbs: ["get"],
      scopeKind: "store",
    });
    // Call shapes and public field names are disclosed so the first program is
    // written against declared arguments; gated material still is not.
    expect(summary.calls).toHaveLength(1);
    expect(summary.calls[0]).toMatch(/^get\(\{ .*\}\)$/);
    expect(summary.resultFields.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toContain("reviewEvidence");
  });

  it("strips ungranted and undeclared fields from result data at runtime, recursively", () => {
    const fields = DAILY_OPERATIONS_MATRIX_FIXTURE.find((manifest) => manifest.namespace.resource === "daySales")!.result.fields;
    const data = {
      operatingDate: "2026-08-21",
      transactionCount: 12,
      revenue: { state: "known", value: { amount: 120_00, currency: "GHS" } },
      topItems: [{ skuRef: "resource:sku-1", quantity: { value: 3, unit: "unit" }, value: { amount: 30_00, currency: "GHS" } }],
      storeId: "k17c5k2q0p3gxz7b3w4h5v6n7m8d9e0f",
    };
    expect(omitUngrantedFields(fields, [], data)).toEqual({
      operatingDate: "2026-08-21",
      transactionCount: 12,
      topItems: [{ skuRef: "resource:sku-1", quantity: { value: 3, unit: "unit" } }],
    });
    expect(omitUngrantedFields(fields, ["financial"], data)).toEqual({
      operatingDate: "2026-08-21",
      transactionCount: 12,
      revenue: { state: "known", value: { amount: 120_00, currency: "GHS" } },
      topItems: [{ skuRef: "resource:sku-1", quantity: { value: 3, unit: "unit" }, value: { amount: 30_00, currency: "GHS" } }],
    });
  });

  it("omits unauthorized fields structurally at the type level", () => {
    type Fields = typeof storeDayManifest.result.fields;
    type Full = FullShape<Fields>;
    type Restricted = ProjectedShape<Fields, never>;
    expectTypeOf<Full>().toHaveProperty("reviewEvidence");
    expectTypeOf<Full["reviewEvidence"]>().toEqualTypeOf<AgentValueState<string>>();
    expectTypeOf<Full["lifecycleStage"]>().toEqualTypeOf<"not_opened" | "open" | "closing" | "closed">();
    expectTypeOf<Full["closeRecordRef"]>().toEqualTypeOf<OpaqueRef<"source"> | undefined>();
    expectTypeOf<Restricted>().not.toHaveProperty("reviewEvidence");
    expectTypeOf<keyof Restricted>().toEqualTypeOf<
      "operatingDate" | "lifecycleStage" | "readiness" | "closeRecordRef"
    >();
    const restricted = {} as Restricted;
    // @ts-expect-error the unauthorized field is absent, not nullable
    const readAbsent = () => restricted.reviewEvidence;
    expect(readAbsent).toBeTypeOf("function");
  });
});

// ---------------------------------------------------------------------------
// Daily Operations capability matrix expressibility
// ---------------------------------------------------------------------------

describe("Daily Operations v1 matrix", () => {
  it("is fully expressible in the v1 manifest contract", () => {
    expect(DAILY_OPERATIONS_MATRIX_FIXTURE).toHaveLength(11);
    for (const manifest of DAILY_OPERATIONS_MATRIX_FIXTURE) {
      expect(validateCapabilityManifest(manifest), manifest.namespace.resource).toEqual({
        ok: true,
        manifest,
      });
    }
    const composed = composeCapabilityPackages(DAILY_OPERATIONS_MATRIX_FIXTURE);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(Object.keys(composed.view.packages).sort()).toEqual([
      "automation",
      "cash",
      "inventory",
      "operations",
      "reports",
    ]);
    expect(composed.view.packages.cash.resources.registerSessions.verbs).toEqual(["get", "list"]);
    expect(composed.view.packages.inventory.resources.positions.verbs).toEqual(["get", "list"]);
  });
});

// ---------------------------------------------------------------------------
// Profile and presentation adapter contracts
// ---------------------------------------------------------------------------

const presentation = definePresentationAdapter({
  contractVersion: 1,
  profileId: "fixture_profile",
  contextBinding: {
    scopeKind: "store",
    keys: ["storeRef", "operatingDate"],
    snapshotKeys: ["operatingDate"],
  },
  contextLabel: (context) => `${context.storeRef} · ${context.operatingDate}`,
  entry: { label: "Ask Athena", location: "daily_operations.header" },
  mountMode: "docked_panel",
  starterIntents: [
    {
      id: "needs_attention",
      label: "What needs attention today?",
      prompt: "What needs my attention today?",
      requiresPackages: ["operations"],
    },
  ],
  resolveSourceDestination: (sourceRef) =>
    sourceRef.kind === "store_day_record"
      ? { kind: "internal_route", route: "/operations/daily", label: "Open store day" }
      : null,
  threadKeyPolicy: {
    parts: ["profileId", "storeRef"],
    onContextChange: "detach_and_offer_new_thread",
    activeTurnPolicy: "block_second_submission",
  },
});

const profile = defineAgentProfile({
  contractVersion: 1,
  profileId: "fixture_profile",
  profileVersion: "1",
  lifecycle: "enabled",
  scope: { kind: "store" },
  packages: [
    { packageKey: "operations", packageVersion: "1.0.0" },
    { packageKey: "inventory", packageVersion: "2.1.0" },
  ],
  budgetPolicy: {
    runLimits: budgetVector({ calls: 24, rows: 5_000, bytes: 2_097_152, costUnits: 500, elapsedMs: 60_000 }),
    maxAttempts: 3,
    maxInFlightCalls: 4,
  },
  promptPolicy: {
    intent: "Answer bounded read-only questions about the store day.",
    untrustedDataLabel: "retrieved_store_data",
    maxPromptBytes: 16_384,
    maxPromptTokens: 4_000,
  },
  egressPolicy: {
    maxClass: "sensitive",
    providers: [{ providerId: "fixture", modelId: "fixture-1", region: "eu", maxClass: "sensitive" }],
  },
  runtimeAdapterKind: "fake_runtime",
  narrativePolicy: "provisional_streaming",
  presentation,
  evaluation: {
    scenarios: [
      { id: "cross", kind: "cross_package", prompt: "Readiness and low stock?", expects: ["operations", "inventory"] },
      { id: "role", kind: "role_restricted", prompt: "Show review evidence", expects: ["absent"] },
      { id: "empty", kind: "partial_or_no_data", prompt: "Anything for 1999-01-01?", expects: ["no_usable_sources"] },
    ],
  },
});

describe("profile contract", () => {
  it("accepts a complete profile and its presentation adapter", () => {
    expect(validateProfileDefinition(profile)).toEqual({ ok: true, profile });
    expect(presentation.contextLabel({ storeRef: "Accra Mall", operatingDate: "2026-08-21" })).toBe(
      "Accra Mall · 2026-08-21",
    );
    expect(presentation.threadKeyPolicy.compose({ storeRef: "s1", operatingDate: "2026-08-21" })).toBe(
      "fixture_profile|storeRef=s1",
    );
  });

  it("passes profile selection against the composed packages", () => {
    const composed = composeCapabilityPackages([storeDayManifest, attentionManifest, inventoryPositionsManifest]);
    if (!composed.ok) throw new Error("fixture should compose");
    expect(assertProfileSelection(profile, composed.view, [storeDayManifest, attentionManifest, inventoryPositionsManifest])).toEqual({ ok: true });
  });

  it("fails selection on unknown packages, version drift, scope mismatch, and egress overreach", () => {
    const composed = composeCapabilityPackages([storeDayManifest, attentionManifest, inventoryPositionsManifest]);
    if (!composed.ok) throw new Error("fixture should compose");
    const manifests = [storeDayManifest, attentionManifest, inventoryPositionsManifest];
    const unknownPackage = defineAgentProfile({
      ...profile,
      packages: [...profile.packages, { packageKey: "payments", packageVersion: "1.0.0" }],
    });
    expect(issueCodes(assertProfileSelection(unknownPackage, composed.view, manifests))).toContain("package_unknown");
    const drift = defineAgentProfile({
      ...profile,
      packages: [{ packageKey: "operations", packageVersion: "9.0.0" }],
    });
    expect(issueCodes(assertProfileSelection(drift, composed.view, manifests))).toContain("package_version_mismatch");
    const orgScoped = { ...profile, scope: { kind: "organization" } } as unknown as typeof profile;
    expect(issueCodes(assertProfileSelection(orgScoped, composed.view, manifests))).toContain("scope_mismatch");
    const lowEgress = defineAgentProfile({
      ...profile,
      egressPolicy: { ...profile.egressPolicy, maxClass: "operational" },
    });
    expect(issueCodes(assertProfileSelection(lowEgress, composed.view, manifests))).toContain("egress_class_exceeded");
    const starterOutside = defineAgentProfile({
      ...profile,
      presentation: definePresentationAdapter({
        ...presentation,
        starterIntents: [{ id: "x", label: "x", prompt: "x", requiresPackages: ["payments"] }],
      }),
    });
    expect(issueCodes(assertProfileSelection(starterOutside, composed.view, manifests))).toContain(
      "starter_intent_package_not_selected",
    );
  });

  it("rejects new scope kinds, mount modes, and thread-key parts outside the context binding", () => {
    const region = { ...profile, scope: { kind: "region" } } as unknown as typeof profile;
    expect(issueCodes(validateProfileDefinition(region))).toContain("versioned_extension_required");
    const voice = {
      ...profile,
      presentation: { ...presentation, mountMode: "voice_overlay" },
    } as unknown as typeof profile;
    expect(issueCodes(validateProfileDefinition(voice))).toContain("versioned_extension_required");
    const badThreadKey = {
      ...profile,
      presentation: {
        ...presentation,
        threadKeyPolicy: { ...presentation.threadKeyPolicy, parts: ["profileId", "region"] },
      },
    } as unknown as typeof profile;
    expect(issueCodes(validateProfileDefinition(badThreadKey))).toContain("thread_key_part_unbound");
    expect(() =>
      defineAgentProfile({ ...profile, scope: { kind: "region" } } as unknown as typeof profile),
    ).toThrow(AgentVersionedExtensionError);
  });

  it("requires a declared narrative policy and rejects an unknown one", () => {
    expect(AGENT_NARRATIVE_POLICIES).toEqual(["provisional_streaming", "buffered"]);
    expect(profile.narrativePolicy).toBe("provisional_streaming");
    for (const policy of AGENT_NARRATIVE_POLICIES) {
      expect(validateProfileDefinition({ ...profile, narrativePolicy: policy })).toMatchObject({ ok: true });
    }

    const withoutPolicy: Record<string, unknown> = { ...profile };
    delete withoutPolicy.narrativePolicy;
    const missing = validateProfileDefinition(withoutPolicy as unknown as typeof profile);
    expect(issueCodes(missing)).toContain("versioned_extension_required");
    expect(missing.ok === false && missing.issues.map((issue) => issue.path)).toContain("narrativePolicy");
    expect(() => defineAgentProfile(withoutPolicy as unknown as typeof profile)).toThrow(AgentVersionedExtensionError);

    const unknown = { ...profile, narrativePolicy: "always_streaming" } as unknown as typeof profile;
    expect(issueCodes(validateProfileDefinition(unknown))).toContain("versioned_extension_required");
    expect(() => defineAgentProfile(unknown)).toThrow(AgentVersionedExtensionError);
  });
});

// ---------------------------------------------------------------------------
// Read-port definition and registration index
// ---------------------------------------------------------------------------

const storeDayPort = defineAgentReadPort({
  contractVersion: 1,
  portKey: "operations.storeDay.get",
  capabilityId: "cap_fixture_storeday",
  verbs: ["get"],
  scopeKind: "store",
  readIntents: ["daily_operations.view", "daily_close.view"],
  implementationVersion: "1",
  declaredCost: storeDayManifest.cost.worstCasePerCall,
  handler: { kind: "internal_query", functionPath: "operations/agentCapabilities/storeDay:getStoreDay" },
  projections: ["managerReview"],
  completenessSourceKeys: ["lifecycle", "closeRecords"],
});

const attentionPort = defineAgentReadPort({
  contractVersion: 1,
  portKey: "operations.attention.list",
  capabilityId: "cap_fixture_attention",
  verbs: ["list"],
  scopeKind: "store",
  readIntents: ["daily_operations.view", "operations.workItems.view"],
  implementationVersion: "1",
  declaredCost: attentionManifest.cost.worstCasePerCall,
  handler: { kind: "internal_query", functionPath: "operations/agentCapabilities/work:listAttention" },
  projections: ["managerReasons"],
  completenessSourceKeys: ["lanes", "pages"],
});

const inventoryPort = defineAgentReadPort({
  contractVersion: 1,
  portKey: "inventory.positions",
  capabilityId: "cap_fixture_inventory_positions",
  verbs: ["get", "list"],
  scopeKind: "store",
  readIntents: ["inventory.stock.view"],
  implementationVersion: "3",
  declaredCost: inventoryPositionsManifest.cost.worstCasePerCall,
  handler: { kind: "internal_query", functionPath: "stockOps/agentCapabilities/inventory:positions" },
  projections: ["costOverlay"],
  completenessSourceKeys: ["positions"],
});

describe("read-port registration index", () => {
  const manifests = [storeDayManifest, attentionManifest, inventoryPositionsManifest];

  it("accepts a covering index", () => {
    expect(
      validateReadPortIndex({ contractVersion: 1, ports: [storeDayPort, attentionPort, inventoryPort] }, manifests),
    ).toEqual({ ok: true });
  });

  it("rejects public api handlers and empty read intents", () => {
    const apiPort = {
      ...storeDayPort,
      handler: { kind: "internal_query", functionPath: "api.operations.dailyOperations.getDailyOperationsSnapshot" },
    } as unknown as typeof storeDayPort;
    expect(issueCodes(validateReadPortDefinition(apiPort))).toContain("handler_not_internal");
    const noIntents = { ...storeDayPort, readIntents: [] } as unknown as typeof storeDayPort;
    expect(issueCodes(validateReadPortDefinition(noIntents))).toContain("read_intents_missing");
  });

  it("fails coverage on missing ports, orphans, duplicates, and binding drift", () => {
    expect(issueCodes(validateReadPortIndex({ contractVersion: 1, ports: [storeDayPort, attentionPort] }, manifests))).toEqual([
      "capability_port_missing",
    ]);
    const orphan = defineAgentReadPort({ ...attentionPort, portKey: "operations.ghost", capabilityId: "cap_ghost_capability" });
    expect(
      issueCodes(validateReadPortIndex({ contractVersion: 1, ports: [storeDayPort, attentionPort, inventoryPort, orphan] }, manifests)),
    ).toEqual(["port_orphaned"]);
    expect(
      issueCodes(validateReadPortIndex({ contractVersion: 1, ports: [storeDayPort, storeDayPort, attentionPort, inventoryPort] }, manifests)),
    ).toEqual(["port_key_duplicate"]);
    const driftedIntents = defineAgentReadPort({ ...storeDayPort, readIntents: ["daily_operations.view"] });
    expect(
      issueCodes(validateReadPortIndex({ contractVersion: 1, ports: [driftedIntents, attentionPort, inventoryPort] }, manifests)),
    ).toEqual(["port_binding_drift"]);
    const wrongPortKey = defineCapabilityManifest({
      ...storeDayManifest,
      binding: { ...storeDayManifest.binding, portKey: "operations.storeDay.other" },
    });
    expect(
      issueCodes(validateReadPortIndex({ contractVersion: 1, ports: [storeDayPort, attentionPort, inventoryPort] }, [wrongPortKey, attentionManifest, inventoryPositionsManifest])),
    ).toEqual(["capability_port_missing", "port_orphaned"]);
  });
});

// ---------------------------------------------------------------------------
// Generated-facade typing contract (bridge)
// ---------------------------------------------------------------------------

describe("generated facade typing", () => {
  type Manifests = readonly [typeof storeDayManifest, typeof attentionManifest, typeof inventoryPositionsManifest];
  type FullFacade = AgentFacade<Manifests, "managerReview" | "managerReasons" | "costOverlay">;
  type RestrictedFacade = AgentFacade<Manifests, never>;

  it("exposes only get/list per resource and no command surface", () => {
    expectTypeOf<keyof FullFacade>().toEqualTypeOf<"operations" | "inventory">();
    expectTypeOf<keyof FullFacade["operations"]>().toEqualTypeOf<"storeDay" | "attention">();
    expectTypeOf<keyof FullFacade["operations"]["storeDay"]>().toEqualTypeOf<"get">();
    expectTypeOf<keyof FullFacade["operations"]["attention"]>().toEqualTypeOf<"list">();
    expectTypeOf<keyof FullFacade["inventory"]["positions"]>().toEqualTypeOf<"get" | "list">();
    expectTypeOf<keyof AgentResourceFacade<typeof inventoryPositionsManifest, never>>().toEqualTypeOf<"get" | "list">();
    function typeOnly(facade: FullFacade) {
      return [
        // @ts-expect-error no command surface exists on a v1 resource
        () => facade.operations.storeDay.propose,
        // @ts-expect-error no command surface exists on a v1 resource
        () => facade.inventory.positions.apply,
        // @ts-expect-error a get-only resource has no list
        () => facade.operations.storeDay.list,
      ];
    }
    expect(typeOnly).toBeTypeOf("function");
    expectTypeOf<FullFacade["operations"]["storeDay"]>().not.toHaveProperty("propose");
    expect(AGENT_FIXED_TOOL_IDS).toEqual([
      "athena.discover",
      "athena.describe",
      "athena.executeProgram",
      "athena.scratch",
      "athena.completeRun",
    ]);
  });

  it("types arguments from filters and results from the granted projection", () => {
    type GetArgs = Parameters<FullFacade["operations"]["storeDay"]["get"]>[0];
    expectTypeOf<GetArgs>().toEqualTypeOf<{ operatingDate: string }>();
    type ListArgs = Parameters<FullFacade["operations"]["attention"]["list"]>[0];
    expectTypeOf<ListArgs>().toEqualTypeOf<{
      operatingDate: string;
      status?: "open" | "resolved";
      cursor?: OpaqueRef<"cursor">;
    }>();
    type FullResult = Awaited<ReturnType<FullFacade["operations"]["storeDay"]["get"]>>;
    type RestrictedResult = Awaited<ReturnType<RestrictedFacade["operations"]["storeDay"]["get"]>>;
    expectTypeOf<FullResult>().toMatchTypeOf<AgentCapabilityOutcome<unknown>>();
    type FullData = Extract<FullResult, { kind: "result" }>["envelope"]["data"];
    type RestrictedData = Extract<RestrictedResult, { kind: "result" }>["envelope"]["data"];
    expectTypeOf<FullData>().toHaveProperty("reviewEvidence");
    expectTypeOf<RestrictedData>().not.toHaveProperty("reviewEvidence");
    type RestrictedItems = Extract<
      Awaited<ReturnType<RestrictedFacade["inventory"]["positions"]["list"]>>,
      { kind: "result" }
    >["envelope"]["data"][number];
    expectTypeOf<keyof RestrictedItems>().toEqualTypeOf<"skuRef" | "onHand">();
  });
});
