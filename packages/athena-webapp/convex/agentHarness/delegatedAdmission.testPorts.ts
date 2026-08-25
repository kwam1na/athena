/**
 * Test-only read-port set for the delegated admission seam.
 *
 * The basename carries two dots on purpose: the Convex bundler, the Convex
 * eslint plugin, and the operation-admission checker all skip multi-dot
 * basenames, so nothing here is ever deployed or treated as ingress. convex-test
 * loads it under the aliased module key `./agentHarness/testPorts.ts`, which is
 * what the port index below names (`agentHarness/testPorts:<export>`).
 *
 * The package is deliberately shaped for the delegated-admission scenarios: a store-scoped
 * profile whose capabilities bind a member-held read intent (so a POS-only
 * operator is granted the capability) while projections require a higher tier
 * (so the same program returns fewer FIELDS for that operator), plus one
 * capability bound to a full-admin-only intent (so the same program returns
 * `unauthorized` for that operator). Handlers derive rows from the admitted
 * store, never from arguments, and return every field: stripping is the
 * kernel's job and that is exactly what the tests prove.
 */
import { anyApi, type FunctionReference } from "convex/server";

import type { MutationCtx } from "../_generated/server";
import { budgetVector } from "../../shared/agentHarness/execution";
import { defineCapabilityManifest } from "../../shared/agentHarness/manifest";
import { defineAgentProfile, definePresentationAdapter } from "../../shared/agentHarness/profile";
import { defineAgentReadPort, type AgentReadPortIndex } from "../../shared/agentHarness/readPort";
import { opaqueRef } from "../../shared/agentHarness/values";
import { createNormalUserDelegatedAuthorityPort } from "../operationAdmission/delegatedAuthority";
import { createSharedDemoDelegatedAuthorityPort } from "../sharedDemo/delegatedAuthority";
import type { AgentEvidenceExtractor } from "./conformance";
import { createDelegatedAdmission } from "./delegatedAdmission";
import type { DelegatedGrantConfig } from "./grants";
import {
  createAgentReadPortRegistry,
  type AgentReadPortHandlerOutput,
  type AgentReadPortInvocationBinding,
} from "./readPorts";
import {
  baselineEnablement,
  buildAgentCapabilityRegistry,
  narrowEnablement,
  type AgentEnablementOverlay,
  type AgentEnablementOverrides,
} from "./registry";

export const TEST_PROFILE_ID = "test_operations";
/**
 * A second profile over the same package, identical except that it keeps the
 * model narrative buffered. Every host and turn test pins `TEST_PROFILE_ID`,
 * so the buffered scenarios need their own profile to run against.
 */
export const TEST_BUFFERED_PROFILE_ID = "test_operations_buffered";
export const TEST_PACKAGE = "ops";
export const TEST_NOW_BASE = 1_700_000_000_000;

const LIST_COST = budgetVector({ calls: 1, rows: 10, bytes: 16_384, costUnits: 2, elapsedMs: 1_000 });
const SNAPSHOT_COST = budgetVector({ calls: 1, rows: 1, bytes: 4_096, costUnits: 1, elapsedMs: 500 });

export const SHIFTS_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_test_ops_shifts",
  namespace: { package: TEST_PACKAGE, resource: "shifts" },
  packageVersion: "1.0.0",
  purpose: "Shifts on the admitted store's current operating day.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page through the store's shifts.",
      filters: {
        status: { kind: "enum", required: false, values: ["open", "closed"], meaning: "Shift status partition." },
      },
      bounds: { kind: "collection", maxItemsPerPage: 10, maxPagesPerRun: 2 },
    },
  },
  result: {
    fields: {
      shiftRef: { kind: "opaqueRef", refKind: "resource", meaning: "Opaque shift ref." },
      label: { kind: "string", meaning: "Shift label." },
      status: { kind: "enum", values: ["open", "closed"], meaning: "Shift status." },
      revenue: { kind: "money", meaning: "Shift revenue.", projection: "financials" },
      managerNotes: { kind: "text", meaning: "Manager review notes.", projection: "managerNotes" },
    },
  },
  projections: {
    financials: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Revenue figures, full admins only." },
    managerNotes: { requires: { tier: "manager" }, egressClass: "sensitive", meaning: "Manager notes, managers and up." },
  },
  // `stale` is declared so the executor tests (V26-1264) can observe a mixed-freshness read.
  freshness: { classes: ["live", "stale"], authority: "live_read", rule: "Live shift roster." },
  completeness: { rule: "Complete once every page is consumed.", sourceKeys: ["shifts"] },
  citation: { rule: "Cite shift refs.", sourceRefKinds: ["shift"] },
  evidence: { mode: "provenance_only", reason: "Shift rows are references." },
  cost: { worstCasePerCall: LIST_COST },
  egressClass: "operational",
  examples: [{ title: "Open shifts", verb: "list", args: { status: "open" }, description: "Shifts still open." }],
  binding: { readIntents: ["daily_operations.view"], portKey: "ops.shifts", implementationVersion: "1" },
});

export const STORE_DAY_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_test_ops_store_day",
  namespace: { package: TEST_PACKAGE, resource: "storeDay" },
  packageVersion: "1.0.0",
  purpose: "One operating day of the admitted store.",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    get: {
      purpose: "One operating day snapshot.",
      filters: {
        operatingDate: { kind: "operatingDate", required: true, meaning: "Operating date to read." },
      },
      bounds: { kind: "snapshot" },
    },
  },
  result: {
    fields: {
      operatingDate: { kind: "operatingDate", meaning: "Operating date." },
      status: { kind: "enum", values: ["open", "closed"], meaning: "Day status." },
      cashVariance: { kind: "money", meaning: "Cash variance.", projection: "financials" },
    },
  },
  projections: {
    financials: { requires: { tier: "full_admin" }, egressClass: "sensitive", meaning: "Cash figures, full admins only." },
  },
  freshness: { classes: ["live"], authority: "live_read", rule: "Live day state." },
  completeness: { rule: "Complete when the day row is present.", sourceKeys: ["day"] },
  citation: { rule: "Cite the day.", sourceRefKinds: ["store_day"] },
  // Extractor-mode evidence so the executor tests (V26-1264) can prove claim-slice promotion.
  evidence: { mode: "extractor", extractorKey: "ops.storeDay", extractorVersion: "1", claimShapes: ["day_status"] },
  cost: { worstCasePerCall: SNAPSHOT_COST },
  egressClass: "operational",
  examples: [{ title: "Today", verb: "get", args: { operatingDate: "2026-08-21" }, description: "Today's day." }],
  binding: { readIntents: ["daily_operations.view"], portKey: "ops.storeDay", implementationVersion: "1" },
});

export const AUDIT_TRAIL_MANIFEST = defineCapabilityManifest({
  contractVersion: 1,
  capabilityId: "cap_test_ops_audit_trail",
  namespace: { package: TEST_PACKAGE, resource: "auditTrail" },
  packageVersion: "1.0.0",
  purpose: "Audit entries for the admitted store (reporting surface).",
  scope: { kind: "store" },
  lifecycle: "enabled",
  operations: {
    list: {
      purpose: "Page through audit entries.",
      filters: {},
      bounds: { kind: "collection", maxItemsPerPage: 10, maxPagesPerRun: 1 },
    },
  },
  result: {
    fields: {
      entryRef: { kind: "opaqueRef", refKind: "source", meaning: "Opaque entry ref." },
      summary: { kind: "string", meaning: "Entry summary." },
    },
  },
  projections: {},
  freshness: { classes: ["accepted"], authority: "authoritative_record", rule: "Accepted audit records." },
  completeness: { rule: "Complete once the single page is consumed.", sourceKeys: ["entries"] },
  citation: { rule: "Cite entry refs.", sourceRefKinds: ["audit_entry"] },
  evidence: { mode: "provenance_only", reason: "Audit rows are references." },
  cost: { worstCasePerCall: LIST_COST },
  egressClass: "operational",
  examples: [{ title: "Recent entries", verb: "list", args: {}, description: "Recent entries." }],
  binding: { readIntents: ["reports.view"], portKey: "ops.auditTrail", implementationVersion: "1" },
});

export const TEST_MANIFESTS = [SHIFTS_MANIFEST, STORE_DAY_MANIFEST, AUDIT_TRAIL_MANIFEST] as const;

export const TEST_READ_PORTS: AgentReadPortIndex = {
  contractVersion: 1,
  ports: [
    defineAgentReadPort({
      contractVersion: 1,
      portKey: "ops.shifts",
      capabilityId: SHIFTS_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "store",
      readIntents: SHIFTS_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: SHIFTS_MANIFEST.cost.worstCasePerCall,
      handler: { kind: "internal_query", functionPath: "agentHarness/testPorts:listShifts" },
      projections: ["financials", "managerNotes"],
      completenessSourceKeys: ["shifts"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: "ops.storeDay",
      capabilityId: STORE_DAY_MANIFEST.capabilityId,
      verbs: ["get"],
      scopeKind: "store",
      readIntents: STORE_DAY_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: STORE_DAY_MANIFEST.cost.worstCasePerCall,
      handler: { kind: "internal_query", functionPath: "agentHarness/testPorts:getStoreDay" },
      projections: ["financials"],
      completenessSourceKeys: ["day"],
    }),
    defineAgentReadPort({
      contractVersion: 1,
      portKey: "ops.auditTrail",
      capabilityId: AUDIT_TRAIL_MANIFEST.capabilityId,
      verbs: ["list"],
      scopeKind: "store",
      readIntents: AUDIT_TRAIL_MANIFEST.binding.readIntents,
      implementationVersion: "1",
      declaredCost: AUDIT_TRAIL_MANIFEST.cost.worstCasePerCall,
      handler: { kind: "internal_query", functionPath: "agentHarness/testPorts:listAuditTrail" },
      projections: [],
      completenessSourceKeys: ["entries"],
    }),
  ],
};

export const TEST_PRESENTATION = definePresentationAdapter({
  contractVersion: 1,
  profileId: TEST_PROFILE_ID,
  contextBinding: { scopeKind: "store", keys: ["storeRef"] },
  contextLabel: (context) => `${context.storeRef}`,
  entry: { label: "Ask Athena", location: "operations.toolbar" },
  mountMode: "docked_panel",
  starterIntents: [
    { id: "open_shifts", label: "Open shifts", prompt: "Which shifts are still open?", requiresPackages: [TEST_PACKAGE] },
    // A curated program the executor rejects at turn time (unknown facade):
    // exercises the host's rejected-pre-read downgrade.
    { id: "bad_read", label: "Bad read", prompt: "Read the unreadable?", requiresPackages: [TEST_PACKAGE] },
    // A curated program whose result overflows the injected-exchange budget:
    // exercises the host's JSON-safe truncation marker.
    { id: "big_read", label: "Big read", prompt: "Read everything at once?", requiresPackages: [TEST_PACKAGE] },
  ],
  resolveSourceDestination: () => null,
  threadKeyPolicy: {
    parts: ["profileId", "storeRef"],
    onContextChange: "confirm_before_next_turn",
    activeTurnPolicy: "block_second_submission",
  },
});

export const TEST_PROFILE = defineAgentProfile({
  contractVersion: 1,
  profileId: TEST_PROFILE_ID,
  profileVersion: "1",
  lifecycle: "enabled",
  scope: { kind: "store" },
  packages: [{ packageKey: TEST_PACKAGE, packageVersion: "1.0.0" }],
  budgetPolicy: {
    runLimits: budgetVector({ calls: 8, rows: 200, bytes: 262_144, costUnits: 40, elapsedMs: 30_000 }),
    maxAttempts: 2,
    maxInFlightCalls: 2,
  },
  promptPolicy: {
    intent: "Answer bounded read-only questions about the store's operating day.",
    untrustedDataLabel: "retrieved_store_data",
    maxPromptBytes: 4_096,
    maxPromptTokens: 1_000,
  },
  egressPolicy: {
    maxClass: "sensitive",
    providers: [{ providerId: "athena_contract_fake", modelId: "fake-1", region: "local", maxClass: "sensitive" }],
  },
  runtimeAdapterKind: "athena_contract_fake",
  narrativePolicy: "provisional_streaming",
  presentation: TEST_PRESENTATION,
  evaluation: {
    scenarios: [
      { id: "cross", kind: "cross_package", prompt: "Open shifts and cash variance?", expects: ["ops.shifts", "ops.storeDay"] },
      { id: "role", kind: "role_restricted", prompt: "Show revenue.", expects: ["revenue absent without financials"] },
      { id: "empty", kind: "partial_or_no_data", prompt: "Shifts in 1999?", expects: ["no_usable_sources"] },
    ],
  },
});

export const TEST_BUFFERED_PRESENTATION = definePresentationAdapter({
  contractVersion: 1,
  profileId: TEST_BUFFERED_PROFILE_ID,
  contextBinding: { scopeKind: "store", keys: ["storeRef"] },
  contextLabel: (context) => `${context.storeRef} (buffered)`,
  entry: { label: "Ask Athena", location: "operations.toolbar.buffered" },
  mountMode: "docked_panel",
  starterIntents: [
    { id: "open_shifts", label: "Open shifts", prompt: "Which shifts are still open?", requiresPackages: [TEST_PACKAGE] },
  ],
  resolveSourceDestination: () => null,
  threadKeyPolicy: {
    parts: ["profileId", "storeRef"],
    onContextChange: "confirm_before_next_turn",
    activeTurnPolicy: "block_second_submission",
  },
});

export const TEST_BUFFERED_PROFILE = defineAgentProfile({
  ...TEST_PROFILE,
  profileId: TEST_BUFFERED_PROFILE_ID,
  narrativePolicy: "buffered",
  presentation: TEST_BUFFERED_PRESENTATION,
});

export const TEST_PROFILES = [TEST_PROFILE, TEST_BUFFERED_PROFILE] as const;

const build = buildAgentCapabilityRegistry({
  manifests: TEST_MANIFESTS,
  readPorts: TEST_READ_PORTS,
  profiles: TEST_PROFILES,
  runtimeAdapter: { adapterKind: "athena_contract_fake", adapterVersion: "fake.1" },
  admissionPolicyVersion: "u4.test",
});
if (!build.ok) {
  throw new Error(`test registry failed to build: ${JSON.stringify(build.issues)}`);
}
export const TEST_REGISTRY = build.registry;

/**
 * In-memory kill switch for the tests. The same module instance is shared
 * between the test file and the Convex functions convex-test runs, so a
 * narrowing applied by a test is observed by the next dispatch.
 */
export const TEST_ENABLEMENT = (() => {
  const baseline: AgentEnablementOverlay = baselineEnablement(TEST_MANIFESTS, TEST_PROFILES);
  let current = baseline;
  return {
    current: () => current,
    narrow(overrides: AgentEnablementOverrides) {
      const narrowed = narrowEnablement(current, overrides);
      if (!narrowed.ok) throw new Error(JSON.stringify(narrowed.issues));
      current = narrowed.overlay;
    },
    reset() {
      current = baseline;
    },
  };
})();

/** Injected clock so demo-session expiry and capture times are deterministic. */
export const TEST_CLOCK = { now: TEST_NOW_BASE };

export const TEST_DEMO_ENVIRONMENT = { ATHENA_SHARED_DEMO_ENABLED: "true", STAGE: "dev" } as const;

/**
 * Handler behaviour switch for contract-violation scenarios. `normal` is the
 * honest port; the others simulate a misbehaving domain port so the tests can
 * prove the kernel fails closed at release.
 */
export const TEST_PORT_BEHAVIOR: {
  shifts: "normal" | "leak_unknown_field" | "leak_raw_id" | "unavailable" | "exceed_bounds" | "throw" | "oversized" | "stale" | "partial";
} = { shifts: "normal" };

/** Manager notes large enough (multibyte) that a full page of ten crosses the 240 KiB evidence ceiling. */
export const TEST_OVERSIZED_NOTE = "é".repeat(30_000);

/**
 * Deterministic, field-minimizing extractor for the store-day snapshot: it
 * copies two already-authorized scalars and nothing else (V26-1264).
 */
export const TEST_STORE_DAY_EXTRACTOR: AgentEvidenceExtractor = {
  extractorKey: "ops.storeDay",
  extractorVersion: "1",
  claimShapes: ["day_status"],
  extract: (input) => {
    const data = input.data as { readonly operatingDate?: unknown; readonly status?: unknown } | null;
    if (!data || typeof data.operatingDate !== "string" || typeof data.status !== "string") {
      return { unsupported: "day_status_not_present_in_result" };
    }
    return { claim: { operatingDate: data.operatingDate, status: data.status } };
  },
};

export const TEST_EVIDENCE_EXTRACTORS: { readonly [capabilityId: string]: AgentEvidenceExtractor } = {
  [STORE_DAY_MANIFEST.capabilityId]: TEST_STORE_DAY_EXTRACTOR,
};

type TestQueryRef = FunctionReference<"query", "internal">;
const testPortRef = (exportName: string) =>
  (anyApi as unknown as { agentHarness: { testPorts: Record<string, TestQueryRef> } }).agentHarness.testPorts[exportName];

export const TEST_PORT_BINDINGS: readonly AgentReadPortInvocationBinding[] = [
  { portKey: "ops.shifts", handler: testPortRef("listShifts") },
  { portKey: "ops.storeDay", handler: testPortRef("getStoreDay") },
  { portKey: "ops.auditTrail", handler: testPortRef("listAuditTrail") },
];

export const TEST_READ_PORT_REGISTRY = createAgentReadPortRegistry({
  registry: TEST_REGISTRY,
  bindings: TEST_PORT_BINDINGS,
});

export const TEST_AUTHORITY_PORTS = {
  normal_user: createNormalUserDelegatedAuthorityPort(),
  shared_demo: createSharedDemoDelegatedAuthorityPort({ environment: TEST_DEMO_ENVIRONMENT }),
};

/** The curated program behind the test profile's `open_shifts` starter intent. */
export const TEST_STARTER_INTENT_PROGRAM = `const shifts = await athena.ops.shifts.list({ status: "open" });
return { outcome: shifts.kind, openShifts: shifts.kind === "result" ? shifts.envelope.data : null };`;

/** Statically invalid under the grant: the executor rejects it at turn time. */
export const TEST_STARTER_INTENT_REJECTED_PROGRAM = `const nothing = await athena.nowhere.nothing.get({});
return { nothing };`;

/** Valid, but its result overflows the injected-exchange byte budget. */
export const TEST_STARTER_INTENT_OVERSIZE_PROGRAM = `const shifts = await athena.ops.shifts.list({ status: "open" });
return { outcome: shifts.kind, filler: "x".repeat(200000) };`;

const TEST_STARTER_INTENT_PROGRAMS: Record<string, string> = {
  open_shifts: TEST_STARTER_INTENT_PROGRAM,
  bad_read: TEST_STARTER_INTENT_REJECTED_PROGRAM,
  big_read: TEST_STARTER_INTENT_OVERSIZE_PROGRAM,
};

export const TEST_GRANT_CONFIG: DelegatedGrantConfig = {
  registry: TEST_REGISTRY,
  authorityPorts: TEST_AUTHORITY_PORTS,
  resolveEnablement: async () => TEST_ENABLEMENT.current(),
  starterIntentProgramFor: (profileId, starterIntentId) =>
    profileId === TEST_PROFILE_ID ? TEST_STARTER_INTENT_PROGRAMS[starterIntentId] : undefined,
  now: () => TEST_CLOCK.now,
};

export const TEST_ADMISSION = createDelegatedAdmission({
  ...TEST_GRANT_CONFIG,
  readPorts: TEST_READ_PORT_REGISTRY,
});

/** Seed a tenant plus an organization member for delegated-operator tests. */
export async function seedDelegatedOperator(
  ctx: MutationCtx,
  slug: string,
  membership: { role: "full_admin" | "pos_only"; operationalRoles?: ("manager" | "cashier")[] } | null,
) {
  const userId = await ctx.db.insert("athenaUser", { email: `${slug}@test` });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: slug,
    slug,
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: `${slug} store`,
    organizationId,
    slug,
  });
  const membershipId = membership
    ? await ctx.db.insert("organizationMember", {
        organizationId,
        userId,
        role: membership.role,
        operationalRoles: membership.operationalRoles,
      })
    : null;
  return { userId, organizationId, storeId, membershipId };
}

const money = (amountMinor: number) => ({ amountMinor, currency: "GHS" });

export const listShifts = TEST_ADMISSION.defineAgentReadPortQuery({
  portKey: "ops.shifts",
  handler: async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
    if (TEST_PORT_BEHAVIOR.shifts === "throw") throw new Error("shift source exploded");
    if (TEST_PORT_BEHAVIOR.shifts === "unavailable") {
      return { kind: "unavailable", reason: "shift_source_offline", retryable: true, sourceKey: "shifts" };
    }
    const store = await ctx.db.get("store", input.scope.storeId!);
    if (!store) return { kind: "unavailable", reason: "store_missing", retryable: false, sourceKey: "shifts" };
    const page = input.cursor === "page-2" ? 2 : 1;
    const baseRows = [
      {
        shiftRef: opaqueRef("resource", `shift-${store.slug}-${page}-morning`),
        label: `${store.name} morning`,
        status: "closed",
        revenue: money(12_500),
        managerNotes: `Notes for ${store.name}`,
      },
      {
        shiftRef: opaqueRef("resource", `shift-${store.slug}-${page}-evening`),
        label: `${store.name} evening`,
        status: "open",
        revenue: money(8_200),
        managerNotes: `Evening notes for ${store.name}`,
      },
    ];
    let rows: Record<string, unknown>[] = baseRows.filter(
      (row) => input.args.status === undefined || row.status === input.args.status,
    );
    if (TEST_PORT_BEHAVIOR.shifts === "leak_unknown_field") {
      rows = rows.map((row) => ({ ...row, internalCostBasis: 3 }));
    }
    if (TEST_PORT_BEHAVIOR.shifts === "leak_raw_id") {
      rows = rows.map((row) => ({ ...row, label: String(store._id) }));
    }
    if (TEST_PORT_BEHAVIOR.shifts === "exceed_bounds") {
      rows = Array.from({ length: 11 }, (_, index) => ({ ...baseRows[0], shiftRef: opaqueRef("resource", `shift-${index}`) }));
    }
    if (TEST_PORT_BEHAVIOR.shifts === "oversized") {
      rows = Array.from({ length: 10 }, (_, index) => ({
        ...baseRows[index % 2],
        shiftRef: opaqueRef("resource", `shift-${store.slug}-big-${index}`),
        label: `${store.name} shift ${index}`,
        managerNotes: TEST_OVERSIZED_NOTE,
      }));
    }
    const stale = TEST_PORT_BEHAVIOR.shifts === "stale";
    return {
      kind: "data",
      data: rows,
      observedAt: stale ? input.now - 3_600_000 : input.now,
      freshness: stale ? { class: "stale", authority: "live_read", staleAfter: input.now - 60_000 } : { class: "live", authority: "live_read" },
      sources: [
        TEST_PORT_BEHAVIOR.shifts === "partial"
          ? { sourceKey: "shifts", status: "partial", reason: "register_offline", missing: ["register-2"] }
          : { sourceKey: "shifts", status: "complete" },
      ],
      sourceRefs: rows.map((row) => ({
        ref: opaqueRef("source", `shift-${store.slug}-${page}`),
        kind: "shift",
        capturedAt: input.now,
      })),
      page: { hasMore: page === 1, rawCursor: page === 1 ? "page-2" : null },
    };
  },
});

export const getStoreDay = TEST_ADMISSION.defineAgentReadPortQuery({
  portKey: "ops.storeDay",
  handler: async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
    const store = await ctx.db.get("store", input.scope.storeId!);
    if (!store) return { kind: "unavailable", reason: "store_missing", retryable: false, sourceKey: "day" };
    return {
      kind: "data",
      data: {
        operatingDate: input.args.operatingDate,
        status: "open",
        cashVariance: money(-150),
      },
      observedAt: input.now,
      freshness: { class: "live", authority: "live_read" },
      sources: [{ sourceKey: "day", status: "complete" }],
      sourceRefs: [{ ref: opaqueRef("source", `day-${store.slug}-${String(input.args.operatingDate)}`), kind: "store_day", capturedAt: input.now }],
    };
  },
});

export const listAuditTrail = TEST_ADMISSION.defineAgentReadPortQuery({
  portKey: "ops.auditTrail",
  handler: async (ctx, input): Promise<AgentReadPortHandlerOutput> => {
    const store = await ctx.db.get("store", input.scope.storeId!);
    if (!store) return { kind: "unavailable", reason: "store_missing", retryable: false, sourceKey: "entries" };
    return {
      kind: "data",
      data: [{ entryRef: opaqueRef("source", `audit-${store.slug}-1`), summary: `${store.name} closed the day` }],
      observedAt: input.now,
      freshness: { class: "accepted", authority: "authoritative_record", sourceVersion: "rev-7" },
      sources: [{ sourceKey: "entries", status: "complete" }],
      // Accepted records carry an immutable revision (V26-1264: reconstructible after replay expiry).
      sourceRefs: [{ ref: opaqueRef("source", `audit-${store.slug}-1`), kind: "audit_entry", version: "rev-7", capturedAt: input.now }],
      page: { hasMore: false, rawCursor: null },
    };
  },
});
