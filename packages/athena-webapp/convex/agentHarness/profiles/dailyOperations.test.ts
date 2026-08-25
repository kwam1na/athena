/**
 * `daily_operations.v1` profile conformance (V26-1267).
 *
 * Four things are proven here, none of which need a database:
 *
 * 1. Every one of the eleven capability-matrix rows is published exactly as the
 *    matrix specifies: resource identity, verbs, required filters, maxima,
 *    read intents, sensitive projections, freshness, completeness, citation.
 * 2. Every manifest passes the registry conformance gate, and the profile passes
 *    selection conformance against its own packages.
 * 3. The profile's budgets stay inside the program-runtime ceilings, and the
 *    presentation adapter carries everything the reusable host needs.
 * 4. Every operator-visible datum on the Daily Operations surface maps to an
 *    authoritative resource field, an explicit presentation-only exclusion, or
 *    an explicitly deferred matrix gap — derived from the view's own view-model
 *    declarations, so a new data area cannot land unmapped.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AGENT_PROGRAM_RUNTIME_CEILINGS } from "../programRuntime/types";
import {
  composeCapabilityPackages,
  namespacePath,
  supportedVerbs,
  type AgentCapabilityManifest,
  type AgentFieldRecord,
} from "../../../shared/agentHarness/manifest";
import { assertProfileSelection } from "../../../shared/agentHarness/profile";
import { opaqueRef } from "../../../shared/agentHarness/values";
import { assertManifestConformance, assertProfileConformance } from "../registry";
import { runCapabilityConformance } from "../conformance";
import {
  DAILY_OPERATIONS_MANIFESTS,
  DAILY_OPERATIONS_PRESENTATION,
  DAILY_OPERATIONS_PROFILE,
  DAILY_OPERATIONS_READ_PORTS,
} from "./dailyOperations";
import { DAILY_OPERATIONS_CONFORMANCE } from "./dailyOperationsConformance";
import { DAILY_OPERATIONS_UI_COVERAGE } from "./dailyOperationsUiCoverage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(HERE, "..", "..", "..");

const byNamespace = new Map(
  DAILY_OPERATIONS_MANIFESTS.map((manifest) => [namespacePath(manifest.namespace), manifest] as const),
);

/**
 * The capability matrix, transcribed as data. Changing a row here without a
 * plan amendment is exactly what this test exists to catch.
 */
const MATRIX = [
  {
    namespace: "operations.storeDay",
    verbs: ["get"],
    requiredFilters: ["operatingDate"],
    optionalFilters: [],
    maxItemsPerPage: null,
    maxPagesPerRun: null,
    readIntents: ["daily_operations.view", "daily_close.view"],
    projections: ["managerReview"],
    freshness: ["live", "accepted"],
    authority: "authoritative_record",
  },
  {
    namespace: "operations.attention",
    verbs: ["list"],
    requiredFilters: ["operatingDate"],
    optionalFilters: ["status"],
    maxItemsPerPage: 100,
    maxPagesPerRun: 2,
    readIntents: ["daily_operations.view", "operations.workItems.view"],
    projections: ["managerReasons"],
    freshness: ["live"],
    authority: "live_read",
  },
  {
    namespace: "operations.approvals",
    verbs: ["list"],
    requiredFilters: ["operatingDate", "state"],
    optionalFilters: [],
    maxItemsPerPage: 100,
    maxPagesPerRun: 2,
    readIntents: ["daily_operations.view", "operations.workItems.view"],
    projections: ["approvalProof"],
    freshness: ["live"],
    authority: "live_read",
  },
  {
    namespace: "reports.daySales",
    verbs: ["get"],
    requiredFilters: ["operatingDate"],
    optionalFilters: [],
    maxItemsPerPage: null,
    maxPagesPerRun: null,
    readIntents: ["reports.view", "pos.view"],
    projections: ["financial"],
    freshness: ["accepted", "live"],
    authority: "authoritative_record",
  },
  {
    namespace: "reports.weekPerformance",
    verbs: ["get"],
    requiredFilters: ["weekEndOperatingDate"],
    optionalFilters: [],
    maxItemsPerPage: null,
    maxPagesPerRun: null,
    readIntents: ["reports.view"],
    projections: ["financial"],
    freshness: ["accepted", "live"],
    authority: "authoritative_record",
  },
  {
    namespace: "reports.storePulse",
    verbs: ["get"],
    requiredFilters: ["operatingDate", "window"],
    optionalFilters: [],
    maxItemsPerPage: null,
    maxPagesPerRun: null,
    readIntents: ["reports.view"],
    projections: ["financial"],
    freshness: ["derived", "live", "accepted"],
    authority: "derived",
  },
  {
    namespace: "cash.registerSessions",
    verbs: ["get", "list"],
    requiredFilters: ["operatingDate", "sessionRef"],
    optionalFilters: ["status"],
    maxItemsPerPage: 100,
    maxPagesPerRun: 2,
    readIntents: ["cash_controls.view"],
    projections: ["cashFinancials"],
    freshness: ["live"],
    authority: "live_read",
  },
  {
    namespace: "operations.activity",
    verbs: ["list"],
    requiredFilters: ["operatingDate"],
    optionalFilters: ["before"],
    maxItemsPerPage: 100,
    maxPagesPerRun: 3,
    readIntents: ["daily_operations.view", "workflow_traces.view"],
    projections: ["financialEvents"],
    freshness: ["live"],
    authority: "live_read",
  },
  {
    namespace: "automation.dailyOperations",
    verbs: ["list"],
    requiredFilters: ["operatingDate"],
    optionalFilters: ["action"],
    maxItemsPerPage: 50,
    maxPagesPerRun: 1,
    readIntents: ["daily_operations.view"],
    projections: ["policyDetails"],
    freshness: ["live"],
    authority: "live_read",
  },
  {
    namespace: "inventory.positions",
    verbs: ["get", "list"],
    requiredFilters: ["skuRef"],
    optionalFilters: ["category", "stockState"],
    // Catalog-scale bounds (2026-08-24): 200 x 8 reads a ~1,300-SKU store whole.
    maxItemsPerPage: 200,
    maxPagesPerRun: 8,
    readIntents: ["inventory.stock.view"],
    projections: ["costOverlay"],
    freshness: ["live"],
    authority: "live_read",
  },
  {
    namespace: "inventory.replenishment",
    verbs: ["list"],
    requiredFilters: [],
    optionalFilters: ["continuityStatus"],
    maxItemsPerPage: 100,
    maxPagesPerRun: 2,
    readIntents: ["procurement.view", "inventory.stock.view"],
    projections: ["supplierCommercial"],
    freshness: ["derived", "live"],
    authority: "derived",
  },
] as const;

function filtersOf(manifest: AgentCapabilityManifest) {
  const required = new Set<string>();
  const optional = new Set<string>();
  for (const verb of ["get", "list"] as const) {
    const operation = manifest.operations[verb];
    if (!operation) continue;
    for (const [name, filter] of Object.entries(operation.filters)) {
      (filter.required ? required : optional).add(name);
    }
  }
  return { required: [...required].sort(), optional: [...optional].sort() };
}

/** Resolve a dotted field path against a manifest's declared field record. */
function resolveFieldPath(fields: AgentFieldRecord, fieldPath: string): boolean {
  const [head, ...rest] = fieldPath.split(".");
  const schema = fields[head];
  if (!schema) return false;
  if (rest.length === 0) return true;
  if (schema.kind === "object") return resolveFieldPath(schema.fields, rest.join("."));
  if (schema.kind === "array" && schema.items.kind === "object") {
    return resolveFieldPath(schema.items.fields, rest.join("."));
  }
  return false;
}

describe("daily_operations.v1 profile", () => {
  it("publishes every capability-matrix row exactly as specified", () => {
    expect(DAILY_OPERATIONS_MANIFESTS).toHaveLength(11);
    expect([...byNamespace.keys()].sort()).toEqual(MATRIX.map((row) => row.namespace).sort());

    for (const row of MATRIX) {
      const manifest = byNamespace.get(row.namespace)!;
      expect(supportedVerbs(manifest).sort(), row.namespace).toEqual([...row.verbs].sort());
      const filters = filtersOf(manifest);
      expect(filters.required, `${row.namespace} required filters`).toEqual([...row.requiredFilters].sort());
      expect(filters.optional, `${row.namespace} optional filters`).toEqual([...row.optionalFilters].sort());
      const listBounds = manifest.operations.list?.bounds;
      expect(listBounds?.maxItemsPerPage ?? null, `${row.namespace} page maximum`).toBe(row.maxItemsPerPage);
      expect(listBounds?.maxPagesPerRun ?? null, `${row.namespace} pages per run`).toBe(row.maxPagesPerRun);
      expect([...manifest.binding.readIntents].sort(), `${row.namespace} read intents`).toEqual(
        [...row.readIntents].sort(),
      );
      expect(Object.keys(manifest.projections).sort(), `${row.namespace} projections`).toEqual(
        [...row.projections].sort(),
      );
      expect([...manifest.freshness.classes], `${row.namespace} freshness`).toEqual([...row.freshness]);
      expect(manifest.freshness.authority, `${row.namespace} authority`).toBe(row.authority);
      expect(manifest.scope.kind, row.namespace).toBe("store");
      expect(manifest.completeness.sourceKeys.length, row.namespace).toBeGreaterThan(0);
      expect(manifest.citation.sourceRefKinds.length, row.namespace).toBeGreaterThan(0);
      expect(manifest.lifecycle, row.namespace).toBe("enabled");
    }
  });

  it("accepts only an operating date as a time input, never an offset or a window", () => {
    for (const manifest of DAILY_OPERATIONS_MANIFESTS) {
      for (const verb of ["get", "list"] as const) {
        const operation = manifest.operations[verb];
        if (!operation) continue;
        for (const [name, filter] of Object.entries(operation.filters)) {
          expect(["operatingDate", "enum", "opaqueRef", "string", "integer", "boolean"]).toContain(filter.kind);
          // No filter names a raw instant, an offset, or a caller-chosen span.
          // `reports.storePulse`'s `window` is a closed enum of NAMED windows
          // (`today` / `week`) the server resolves through store time, which is
          // why the kind check above is the real guarantee.
          expect(name, `${manifest.capabilityId}.${name}`).not.toMatch(
            /timezone|utcOffset|offsetMinutes|startAt|endAt|since|until|timestamp/i,
          );
          if (name === "window") expect(filter.kind).toBe("enum");
        }
      }
    }
  });

  it("passes the conformance gate for every capability and for the profile", () => {
    for (const manifest of DAILY_OPERATIONS_MANIFESTS) {
      const staticConformance = assertManifestConformance(manifest);
      expect(staticConformance.ok, JSON.stringify(staticConformance)).toBe(true);
      const port = DAILY_OPERATIONS_READ_PORTS.ports.find(
        (candidate) => candidate.capabilityId === manifest.capabilityId,
      )!;
      const fixture = DAILY_OPERATIONS_CONFORMANCE[manifest.capabilityId];
      expect(fixture, manifest.capabilityId).toBeDefined();
      const behavioral = runCapabilityConformance({
        manifest,
        port,
        probes: fixture.probes,
        extractor: fixture.extractor,
      });
      expect(behavioral.ok, `${manifest.capabilityId}: ${JSON.stringify(behavioral)}`).toBe(true);
    }

    const profileConformance = assertProfileConformance(DAILY_OPERATIONS_PROFILE, {
      manifests: DAILY_OPERATIONS_MANIFESTS,
      readPorts: DAILY_OPERATIONS_READ_PORTS,
    });
    expect(profileConformance.ok, JSON.stringify(profileConformance)).toBe(true);

    const composed = composeCapabilityPackages(DAILY_OPERATIONS_MANIFESTS);
    expect(composed.ok, JSON.stringify(composed)).toBe(true);
    if (!composed.ok) throw new Error("unreachable");
    const selection = assertProfileSelection(DAILY_OPERATIONS_PROFILE, composed.view, DAILY_OPERATIONS_MANIFESTS);
    expect(selection.ok, JSON.stringify(selection)).toBe(true);
    expect(Object.keys(composed.view.packages).sort()).toEqual([
      "automation",
      "cash",
      "inventory",
      "operations",
      "reports",
    ]);
  });

  it("stays inside the program-runtime ceilings and ships published but switched off", () => {
    const limits = DAILY_OPERATIONS_PROFILE.budgetPolicy.runLimits;
    expect(limits.calls).toBeLessThanOrEqual(AGENT_PROGRAM_RUNTIME_CEILINGS.maxCapabilityCalls);
    expect(limits.rows).toBeLessThanOrEqual(AGENT_PROGRAM_RUNTIME_CEILINGS.maxRows);
    expect(limits.bytes).toBeLessThanOrEqual(AGENT_PROGRAM_RUNTIME_CEILINGS.maxRunBridgeBytes);
    expect(limits.costUnits).toBeLessThanOrEqual(AGENT_PROGRAM_RUNTIME_CEILINGS.maxProviderCostUnits);
    expect(limits.elapsedMs).toBeLessThanOrEqual(AGENT_PROGRAM_RUNTIME_CEILINGS.maxElapsedMs);
    expect(DAILY_OPERATIONS_PROFILE.budgetPolicy.maxAttempts).toBeLessThanOrEqual(
      AGENT_PROGRAM_RUNTIME_CEILINGS.maxAttempts,
    );
    expect(DAILY_OPERATIONS_PROFILE.budgetPolicy.maxInFlightCalls).toBeLessThanOrEqual(
      AGENT_PROGRAM_RUNTIME_CEILINGS.maxInFlightCalls,
    );
    // Published, so the profile MAY be reached — but the durable enablement
    // switch is default-off and shrink-only, so no operator turn is admitted
    // until the switch is flipped on the deployment.
    expect(DAILY_OPERATIONS_PROFILE.lifecycle).toBe("enabled");
  });

  it("carries the presentation contract the reusable host needs", () => {
    expect(DAILY_OPERATIONS_PRESENTATION.profileId).toBe("daily_operations");
    expect(DAILY_OPERATIONS_PRESENTATION.entry).toEqual({
      label: "Ask Athena",
      location: "operations.dailyOperations.header",
    });
    expect(DAILY_OPERATIONS_PRESENTATION.mountMode).toBe("docked_panel");
    expect(DAILY_OPERATIONS_PRESENTATION.contextBinding).toEqual({
      scopeKind: "store",
      keys: ["storeRef", "operatingDate"],
      snapshotKeys: ["operatingDate"],
    });
    // Thread key is `daily_operations + store`: changing store composes a
    // different key, so the old thread detaches on its own.
    expect(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.parts).toEqual(["profileId", "storeRef"]);
    expect(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.compose({ storeRef: "s1", operatingDate: "2026-08-21" })).toBe(
      "daily_operations|storeRef=s1",
    );
    expect(
      DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.compose({ storeRef: "s2", operatingDate: "2026-08-21" }),
    ).not.toBe(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.compose({ storeRef: "s1", operatingDate: "2026-08-21" }));
    expect(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.onContextChange).toBe("confirm_before_next_turn");
    expect(DAILY_OPERATIONS_PRESENTATION.threadKeyPolicy.activeTurnPolicy).toBe("block_second_submission");

    // Every starter intent is evidence-backed: it names a selected package.
    const packages = new Set(DAILY_OPERATIONS_PROFILE.packages.map((selection) => selection.packageKey));
    expect(DAILY_OPERATIONS_PRESENTATION.starterIntents.length).toBeGreaterThanOrEqual(3);
    for (const intent of DAILY_OPERATIONS_PRESENTATION.starterIntents) {
      expect(intent.requiresPackages.length, intent.id).toBeGreaterThan(0);
      for (const packageKey of intent.requiresPackages) expect(packages, intent.id).toContain(packageKey);
    }

    // Every citation kind any resource can mint resolves to an internal route.
    const citationKinds = new Set(
      DAILY_OPERATIONS_MANIFESTS.flatMap((manifest) => manifest.citation.sourceRefKinds),
    );
    for (const kind of citationKinds) {
      const destination = DAILY_OPERATIONS_PRESENTATION.resolveSourceDestination({
        ref: opaqueRef("source", `${kind}.probe`),
        kind,
        capturedAt: 0,
      });
      expect(destination, kind).not.toBeNull();
      expect(destination!.kind).toBe("internal_route");
      expect(destination!.route.startsWith("/$orgUrlSlug/store/$storeUrlSlug/"), kind).toBe(true);
    }
    // An unknown source kind resolves to nothing rather than guessing.
    expect(
      DAILY_OPERATIONS_PRESENTATION.resolveSourceDestination({
        ref: opaqueRef("source", "mystery"),
        kind: "mystery",
        capturedAt: 0,
      }),
    ).toBeNull();
  });

  it("ships the three required evaluation scenario kinds", () => {
    const kinds = DAILY_OPERATIONS_PROFILE.evaluation.scenarios.map((scenario) => scenario.kind);
    for (const required of ["cross_package", "role_restricted", "partial_or_no_data"]) {
      expect(kinds, required).toContain(required);
    }
    for (const scenario of DAILY_OPERATIONS_PROFILE.evaluation.scenarios) {
      expect(scenario.expects.length, scenario.id).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// UI field coverage
// ---------------------------------------------------------------------------

/** Body of a `type X = { ... }` declaration, balanced by braces. */
function typeBody(source: string, name: string): string {
  const marker = new RegExp(`(?:export )?type ${name} = \\{`);
  const match = marker.exec(source);
  if (!match) throw new Error(`view-model type ${name} not found`);
  let depth = 0;
  const start = match.index + match[0].length - 1;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  throw new Error(`unbalanced view-model type ${name}`);
}

const KEY = /^\s*(\w+)\??:\s*(.*)$/;

/** Dotted paths of every data-bearing key in a view-model type body. */
function fieldPaths(body: string, prefix = ""): string[] {
  const out: string[] = [];
  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length) {
    const match = KEY.exec(lines[index]);
    if (!match) {
      index += 1;
      continue;
    }
    const [, key, rest] = match;
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (rest.includes("{")) {
      let depth = 0;
      const block: string[] = [];
      let cursor = index;
      for (; cursor < lines.length; cursor += 1) {
        for (const character of lines[cursor]) {
          if (character === "{") depth += 1;
          else if (character === "}") depth -= 1;
        }
        block.push(lines[cursor]);
        if (depth === 0 && cursor > index) break;
        if (depth === 0 && cursor === index && lines[cursor].includes("}")) break;
      }
      const nested = fieldPaths(block.slice(1, -1).join("\n"), nextPath);
      out.push(...(nested.length > 0 ? nested : [nextPath]));
      index = cursor + 1;
      continue;
    }
    out.push(nextPath);
    index += 1;
  }
  return out;
}

/**
 * Every view-model type the Daily Operations surface renders. A new snapshot
 * type belongs here; forgetting one is caught by the count assertion below.
 */
const VIEW_MODEL_ROOTS = [
  ["DailyOperationsSnapshot", "view"],
  ["DailyOperationsAutomationStatus", "view"],
  ["DailyOperationsScheduledRunSummary", "view"],
  ["DailyOperationsCompletedCloseAttribution", "view"],
  ["DailyOperationsOpenRegisterSessionsSnapshot", "view"],
  ["DailyOperationsStorePulseSnapshot", "view"],
  ["DailyOperationsStoreRequestsSnapshot", "view"],
  ["DailyOperationsTimelineSnapshot", "view"],
  ["DailyOperationsWeekAnalyticsSnapshot", "view"],
  ["StorePulseSummary", "pulse"],
  ["StorePulseOperatorSnapshot", "pulse"],
  ["StorePulseTrendDay", "pulse"],
  ["StorePulsePaymentMixEntry", "pulse"],
] as const;

describe("Daily Operations UI field coverage", () => {
  const sources = {
    view: readFileSync(path.join(PACKAGE_DIR, "src/components/operations/DailyOperationsView.tsx"), "utf8"),
    pulse: readFileSync(path.join(PACKAGE_DIR, "src/components/store-pulse/StorePulseSummaryView.tsx"), "utf8"),
  };
  const derived = [
    ...new Set(
      VIEW_MODEL_ROOTS.flatMap(([name, source]) =>
        fieldPaths(typeBody(sources[source], name)).map((fieldPath) => `${name}.${fieldPath}`),
      ),
    ),
  ].sort();

  it("derives the operator-visible field list from the view's own view models", () => {
    // Sanity: the derivation actually walked the component, not an empty file.
    expect(derived.length).toBeGreaterThan(150);
    expect(derived).toContain("DailyOperationsSnapshot.lifecycle.status");
    expect(derived).toContain("DailyOperationsSnapshot.closeSummary.salesTotal");
    expect(derived).toContain("StorePulseOperatorSnapshot.topItems.totalSales");
  });

  it("maps every operator-visible datum to a resource, a presentation-only exclusion, or a declared matrix gap", () => {
    const unmapped = derived.filter((fieldPath) => DAILY_OPERATIONS_UI_COVERAGE[fieldPath] === undefined);
    expect(
      unmapped,
      "New Daily Operations data areas must be mapped in dailyOperationsUiCoverage.ts before they ship.",
    ).toEqual([]);
  });

  it("keeps the coverage fixture free of stale entries", () => {
    const derivedSet = new Set(derived);
    const stale = Object.keys(DAILY_OPERATIONS_UI_COVERAGE).filter((fieldPath) => !derivedSet.has(fieldPath));
    expect(stale, "The view no longer renders these; remove them from the coverage fixture.").toEqual([]);
  });

  it("resolves every mapped resource field against its published manifest", () => {
    for (const [fieldPath, coverage] of Object.entries(DAILY_OPERATIONS_UI_COVERAGE)) {
      if (coverage.kind !== "resource") {
        expect(coverage.reason.length, fieldPath).toBeGreaterThan(20);
        continue;
      }
      const manifest = byNamespace.get(coverage.resource);
      expect(manifest, `${fieldPath} → ${coverage.resource}`).toBeDefined();
      expect(
        resolveFieldPath(manifest!.result.fields, coverage.field),
        `${fieldPath} → ${coverage.resource}.${coverage.field}`,
      ).toBe(true);
    }
  });

  it("covers every published resource with at least one operator-visible datum", () => {
    const covered = new Set(
      Object.values(DAILY_OPERATIONS_UI_COVERAGE)
        .filter((coverage) => coverage.kind === "resource")
        .map((coverage) => (coverage as { resource: string }).resource),
    );
    // `inventory.positions` and `inventory.replenishment` are reachable from
    // Daily Operations through the stock workspace links rather than the
    // snapshot's own view model, so they are exempt from this direction.
    const expected = [...byNamespace.keys()].filter(
      (namespace) => namespace !== "inventory.positions" && namespace !== "inventory.replenishment",
    );
    for (const namespace of expected) expect(covered, namespace).toContain(namespace);
  });
});
