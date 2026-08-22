// @vitest-environment node
/**
 * Program sandbox spike and smoke suite.
 *
 * The chosen runtime is direct QuickJS (`quickjs-emscripten-core` with the
 * single-file wasm variant) behind the Athena `AgentProgramRuntime` contract;
 * see `docs/agent/agent-harness-runtime.md` for the decision record against
 * `@ai-sdk/code-mode`. Everything here drives the runtime only through the
 * Athena contract: a facade shape, a host bridge, typed ceilings, and typed
 * outcomes. No guest program can reach anything the bridge does not hand it.
 */
import { describe, expect, it } from "vitest";

import type { JsonValue } from "../../../shared/agentHarness/manifest";
import { fitEncodedCallOutput, measureUtf8Bytes } from "./outputCeiling";
import { validateProgramSource } from "./programValidation";
import { createQuickJsProgramRuntime } from "./quickJsRuntime";
import {
  AGENT_PROGRAM_RUNTIME_CEILINGS,
  type AgentProgramHostBridge,
  type AgentProgramHostCall,
  type AgentProgramOutcome,
  type AgentProgramRuntime,
  type AgentProgramRuntimeCeilings,
  type AgentProgramValidationResult,
} from "./types";

const FACADE: AgentProgramHostBridge["facade"] = [
  { package: "ops", resource: "storeDay", verbs: ["get"] },
  { package: "ops", resource: "queue", verbs: ["list"] },
  { package: "fleet", resource: "stores", verbs: ["list", "get"] },
];

type HostCallRecord = AgentProgramHostCall & { readonly startedAt: number; readonly endedAt?: number };

function makeBridge(
  respond: (call: AgentProgramHostCall) => Promise<JsonValue> | JsonValue = async (call) => ({
    path: `${call.package}.${call.resource}.${call.verb}`,
    args: call.args,
    items: [1, 2, 3],
  }),
) {
  const calls: HostCallRecord[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const bridge: AgentProgramHostBridge = {
    facade: FACADE,
    invoke: async (call) => {
      const record: { -readonly [K in keyof HostCallRecord]: HostCallRecord[K] } = { ...call, startedAt: Date.now() };
      calls.push(record);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await respond(call);
      } finally {
        inFlight -= 1;
        record.endedAt = Date.now();
      }
    },
  };
  return { bridge, calls, maxInFlight: () => maxInFlight };
}

let runtimePromise: Promise<AgentProgramRuntime> | undefined;
function runtime(): Promise<AgentProgramRuntime> {
  runtimePromise ??= createQuickJsProgramRuntime();
  return runtimePromise;
}

async function execute(
  source: string,
  options: {
    bridge?: AgentProgramHostBridge;
    ceilings?: Partial<AgentProgramRuntimeCeilings>;
    signal?: AbortSignal;
  } = {},
): Promise<AgentProgramOutcome> {
  const rt = await runtime();
  return rt.execute({
    source,
    bridge: options.bridge ?? makeBridge().bridge,
    ceilings: { ...AGENT_PROGRAM_RUNTIME_CEILINGS, maxElapsedMs: 2_000, ...options.ceilings },
    signal: options.signal,
  });
}

function expectFailed(outcome: AgentProgramOutcome, code: string) {
  expect(outcome.status, JSON.stringify(outcome)).toBe("failed");
  if (outcome.status !== "failed") return;
  expect(outcome.code).toBe(code);
}

function expectRejected(outcome: AgentProgramValidationResult | AgentProgramOutcome, code: string) {
  const status = "status" in outcome ? outcome.status : "accepted";
  expect(status, JSON.stringify(outcome)).toBe("rejected");
  if (!("status" in outcome) || outcome.status !== "rejected") return;
  expect(outcome.issues.map((issue) => issue.code)).toContain(code);
}

describe("program runtime ceilings (typed config the executor consumes)", () => {
  it("publishes the initial safety ceilings from the plan", () => {
    expect(AGENT_PROGRAM_RUNTIME_CEILINGS).toMatchObject({
      maxElapsedMs: 60_000,
      maxAttempts: 3,
      maxCapabilityCalls: 24,
      maxInFlightCalls: 4,
      maxRows: 5_000,
      maxRunBridgeBytes: 2 * 1024 * 1024,
      maxCallOutputBytes: 240 * 1024,
      maxSourceBytes: 32 * 1024,
      maxResultBytes: 256 * 1024,
      maxHeapBytes: 64 * 1024 * 1024,
    });
    expect(AGENT_PROGRAM_RUNTIME_CEILINGS.maxProviderTokens).toBeGreaterThan(0);
    expect(AGENT_PROGRAM_RUNTIME_CEILINGS.maxProviderCostUnits).toBeGreaterThan(0);
    expect(Object.isFrozen(AGENT_PROGRAM_RUNTIME_CEILINGS)).toBe(true);
  });
});

describe("static program validation (Athena-owned, outside the sandbox)", () => {
  const facade = { facade: FACADE };

  it("accepts an import-free async program with exactly one explicit output", () => {
    const result = validateProgramSource(
      `const day = await athena.ops.storeDay.get({ operatingDate: "2026-08-21" });
       const queue = await athena.ops.queue.list({ limit: 10 });
       return { day, queue };`,
      facade,
    );
    expect(result).toEqual({ ok: true, source: expect.any(String), sourceBytes: expect.any(Number) });
  });

  it("rejects imports, exports, require, and dynamic import before any read", () => {
    expectRejected(validateProgramSource(`import fs from "node:fs"; return 1;`, facade), "import_forbidden");
    expectRejected(validateProgramSource(`export const x = 1; return x;`, facade), "export_forbidden");
    expectRejected(validateProgramSource(`const fs = require("fs"); return fs;`, facade), "forbidden_identifier");
    expectRejected(validateProgramSource(`const m = await import("x"); return m;`, facade), "import_forbidden");
  });

  it("rejects host globals, network, filesystem, eval, timers, clock, and randomness", () => {
    const cases: Array<[string, string]> = [
      [`return globalThis;`, "forbidden_identifier"],
      [`return process.env;`, "forbidden_identifier"],
      [`return fetch("https://x");`, "forbidden_identifier"],
      [`return eval("1");`, "forbidden_identifier"],
      [`return new Function("return 1")();`, "forbidden_identifier"],
      [`setTimeout(() => {}, 1); return 1;`, "forbidden_identifier"],
      [`return Date.now();`, "forbidden_identifier"],
      [`return Math.random();`, "forbidden_member"],
      [`return crypto.randomUUID();`, "forbidden_identifier"],
      [`return Reflect.ownKeys(athena);`, "forbidden_identifier"],
      [`return new Proxy({}, {});`, "forbidden_identifier"],
      [`return this;`, "forbidden_this"],
      [`with (athena) { return ops; }`, "forbidden_syntax"],
    ];
    for (const [source, code] of cases) {
      expectRejected(validateProgramSource(source, facade), code);
    }
  });

  it("rejects mutation handles and prototype escapes statically", () => {
    expectRejected(validateProgramSource(`return athena.ops.storeDay.constructor;`, facade), "forbidden_member");
    expectRejected(validateProgramSource(`return ({}).__proto__;`, facade), "forbidden_member");
    expectRejected(validateProgramSource(`return athena["constructor"];`, facade), "forbidden_member");
    expectRejected(validateProgramSource(`return athena.ops.storeDay.update({});`, facade), "facade_path_unknown");
    expectRejected(validateProgramSource(`return athena.command.apply({});`, facade), "facade_misuse");
  });

  it("rejects facade misuse that type stripping alone would let through", () => {
    expectRejected(validateProgramSource(`const r = await athena.ops.storeDay.get(42); return r;`, facade), "facade_args_invalid");
    expectRejected(validateProgramSource(`return athena.ops.storeDay.get({}, {});`, facade), "facade_args_invalid");
    expectRejected(validateProgramSource(`return athena.nothere.x.get({});`, facade), "facade_path_unknown");
    expectRejected(validateProgramSource(`return athena.ops.queue.get({});`, facade), "facade_path_unknown");
    expectRejected(validateProgramSource(`const g = athena.ops; return g.storeDay.get({});`, facade), "facade_misuse");
    expectRejected(validateProgramSource(`const f = athena.ops.storeDay.get; return f({});`, facade), "facade_misuse");
    expectRejected(validateProgramSource(`return [athena].length;`, facade), "facade_misuse");
    expectRejected(validateProgramSource(`return athena["ops"].storeDay.get({});`, facade), "facade_misuse");
    expectRejected(validateProgramSource(`const x = ; return x;`, facade), "syntax_error");
    expectRejected(validateProgramSource(`enum Mode { A } return Mode.A;`, facade), "unsupported_syntax");
    expectRejected(validateProgramSource(`class Box { value = 1 } return new Box();`, facade), "forbidden_syntax");
  });

  it("strips erasable TypeScript and executes the stripped program", async () => {
    const source = `interface Row { readonly id: string }
      type Maybe<T> = T | null;
      const total: number = [1, 2, 3].reduce((acc: number, n: number): number => acc + n, 0 as number);
      const rows = [{ id: "a" }] satisfies Row[];
      const first: Maybe<Row> = rows[0]!;
      const pick = <T,>(value: T): T => value;
      const label = (x?: string) => x ?? "none";
      return { total, first: first as Row, picked: pick(1), label: label() };`;
    const validation = validateProgramSource(source, facade);
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
    if (!validation.ok) return;
    expect(validation.source).not.toMatch(/interface|satisfies|Maybe</);
    const outcome = await execute(source);
    expect(outcome.status, JSON.stringify(outcome)).toBe("completed");
    if (outcome.status === "completed") expect(outcome.output).toEqual({ total: 6, first: { id: "a" }, picked: 1, label: "none" });
  });

  it("documents the gap: semantic type checking is not performed (runtime validation owns argument shapes)", () => {
    expect(validateProgramSource(`const n: number = "x"; return n;`, facade).ok).toBe(true);
  });

  it("requires exactly one explicit top-level output", () => {
    expectRejected(validateProgramSource(`const x = 1;`, facade), "missing_output");
    expectRejected(validateProgramSource(`if (true) { return 1; } return 2;`, facade), "multiple_outputs");
    expectRejected(validateProgramSource(`return 1; const after = 2;`, facade), "unreachable_after_output");
    expect(
      validateProgramSource(`const pick = (xs: number[]) => { return xs[0]; }; return pick([1]);`, facade).ok,
    ).toBe(true);
  });

  it("enforces the 32 KiB source ceiling before parsing", () => {
    const big = `const pad = "${"x".repeat(33 * 1024)}"; return pad.length;`;
    expectRejected(validateProgramSource(big, facade), "source_too_large");
  });
});

describe("sandbox execution through the athena.* facade", () => {
  it("runs multi-package async calls and bounded Promise.all through the bridge", async () => {
    const { bridge, calls, maxInFlight } = makeBridge(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { path: `${call.package}.${call.resource}.${call.verb}`, items: [call.args] };
    });
    const outcome = await execute(
      `const [day, queue, stores] = await Promise.all([
         athena.ops.storeDay.get({ operatingDate: "2026-08-21" }),
         athena.ops.queue.list({ limit: 5 }),
         athena.fleet.stores.list({ cursor: undefined }),
       ]);
       const detail = await athena.fleet.stores.get({ storeRef: "source:abc" });
       return { paths: [day.path, queue.path, stores.path, detail.path], n: day.items.length };`,
      { bridge },
    );
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toEqual({
      paths: ["ops.storeDay.get", "ops.queue.list", "fleet.stores.list", "fleet.stores.get"],
      n: 1,
    });
    expect(calls.map((call) => `${call.package}.${call.resource}.${call.verb}`)).toEqual([
      "ops.storeDay.get",
      "ops.queue.list",
      "fleet.stores.list",
      "fleet.stores.get",
    ]);
    expect(calls[0].args).toEqual({ operatingDate: "2026-08-21" });
    expect(maxInFlight()).toBe(3);
    expect(outcome.diagnostics).toMatchObject({ hostCalls: 4, maxInFlight: 3 });
    expect(outcome.diagnostics.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("exposes only the facade: no host globals, network, fs, eval, timers, clock, randomness", async () => {
    const outcome = await execute(
      `return {
         fetch: typeof fetch, process: typeof process, require: typeof require,
         timers: typeof setTimeout, date: typeof Date, random: typeof Math.random,
         proxy: typeof Proxy, reflect: typeof Reflect, evalKind: typeof eval,
         fn: typeof Function, globalKeys: Object.getOwnPropertyNames(globalThis).filter((k) => k.startsWith("__")),
       };`,
      { ceilings: {} },
    );
    // The static validator bans these identifiers; this probe bypasses it on purpose.
    expect(outcome.status).toBe("rejected");
    const raw = await (await runtime()).executeUnvalidated({
      source: `return {
         fetch: typeof fetch, process: typeof process, require: typeof require,
         timers: typeof setTimeout, date: typeof Date, random: typeof Math.random,
         proxy: typeof Proxy, reflect: typeof Reflect,
         hostKeys: Object.getOwnPropertyNames(globalThis).filter((k) => k.startsWith("__")),
       };`,
      bridge: makeBridge().bridge,
      ceilings: { ...AGENT_PROGRAM_RUNTIME_CEILINGS, maxElapsedMs: 2_000 },
    });
    expect(raw.status).toBe("completed");
    if (raw.status !== "completed") return;
    expect(raw.output).toEqual({
      fetch: "undefined",
      process: "undefined",
      require: "undefined",
      timers: "undefined",
      date: "undefined",
      random: "undefined",
      proxy: "undefined",
      reflect: "undefined",
      hostKeys: [],
    });
  });

  it("fails dynamic code and prototype escape attempts inside the sandbox as well", async () => {
    const rt = await runtime();
    const attempts = [
      `return eval("1 + 1");`,
      `return new Function("return 1")();`,
      `return Object.getPrototypeOf(athena.ops.storeDay.get).constructor("return 1")();`,
      `return (async () => {}).constructor("return 1")();`,
    ];
    for (const source of attempts) {
      const outcome = await rt.executeUnvalidated({
        source,
        bridge: makeBridge().bridge,
        ceilings: { ...AGENT_PROGRAM_RUNTIME_CEILINGS, maxElapsedMs: 2_000 },
      });
      expect(outcome.status, source).toBe("failed");
      if (outcome.status === "failed") expect(outcome.code).toBe("runtime_error");
    }
  });

  it("cannot mutate or reach beyond the facade objects", async () => {
    const { bridge, calls } = makeBridge();
    const probe = `const before = Object.isFrozen(athena) && Object.isFrozen(athena.ops) && Object.isFrozen(athena.ops.storeDay);
       let threw = false;
       try { athena.ops.storeDay.get = () => 1; } catch { threw = true; }
       const keys = Object.keys(athena.ops.storeDay);
       return { before, threw, keys, sameFn: athena.ops.storeDay.get === athena.ops.storeDay.get };`;
    // Statically the facade is readonly, so Athena validation rejects the assignment outright.
    expectRejected(validateProgramSource(probe, { facade: FACADE }), "facade_misuse");
    // Inside the sandbox the facade is deep-frozen, so even an unvalidated program cannot change it.
    const outcome = await (await runtime()).executeUnvalidated({
      source: probe,
      bridge,
      ceilings: { ...AGENT_PROGRAM_RUNTIME_CEILINGS, maxElapsedMs: 2_000 },
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toEqual({ before: true, threw: true, keys: ["get"], sameFn: true });
    expect(calls).toHaveLength(0);
  });
});

describe("sandbox limits terminate cleanly with typed diagnostics", () => {
  it("stops a runaway loop at the elapsed ceiling", async () => {
    const outcome = await execute(`while (true) {} return 1;`, { ceilings: { maxElapsedMs: 200 } });
    expectFailed(outcome, "timeout");
    if (outcome.status === "failed") expect(outcome.diagnostics.elapsedMs).toBeLessThan(2_000);
  });

  it("stops allocation at the heap ceiling", async () => {
    // QuickJS retries GC as it approaches the ceiling, so reaching OOM can take seconds; the elapsed
    // ceiling still bounds the attempt either way.
    const outcome = await execute(
      `const chunks: string[] = []; while (true) { chunks.push("x".repeat(1_000_000)); } return chunks.length;`,
      { ceilings: { maxHeapBytes: 8 * 1024 * 1024, maxElapsedMs: 15_000 } },
    );
    expectFailed(outcome, "memory_limit");
    if (outcome.status === "failed") expect(outcome.diagnostics.memoryUsedBytes).toBeDefined();
  }, 20_000);

  it("stops unbounded recursion at the stack ceiling", async () => {
    const outcome = await execute(`const f = (n: number): number => f(n + 1) + 1; return f(0);`);
    expectFailed(outcome, "stack_overflow");
    // Ceilings above the engine's safe stack are clamped rather than corrupting the runtime.
    const clamped = await execute(`const f = (n: number): number => f(n + 1) + 1; return f(0);`, {
      ceilings: { maxStackBytes: 8 * 1024 * 1024 },
    });
    expectFailed(clamped, "stack_overflow");
  });

  it("stops at the capability-call ceiling and the in-flight ceiling", async () => {
    const { bridge: countingBridge, calls } = makeBridge();
    const tooMany = await execute(
      `for (let i = 0; i < 30; i += 1) { await athena.ops.queue.list({ i }); } return "done";`,
      { bridge: countingBridge, ceilings: { maxCapabilityCalls: 24 } },
    );
    expectFailed(tooMany, "call_limit");
    expect(calls).toHaveLength(24);

    const { bridge: slowBridge, calls: slowCalls } = makeBridge(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ok: true };
    });
    const tooWide = await execute(
      `await Promise.all(Array.from({ length: 8 }, (_, i) => athena.ops.queue.list({ i }))); return "done";`,
      { bridge: slowBridge, ceilings: { maxInFlightCalls: 4 } },
    );
    expectFailed(tooWide, "in_flight_limit");
    expect(slowCalls.length).toBeLessThanOrEqual(4);
  });

  it("stops at the per-call output ceiling and the run bridge ceiling before the program sees the data", async () => {
    const { bridge: wideBridge } = makeBridge(async () => ({ blob: "y".repeat(250 * 1024) }));
    const tooBig = await execute(`const r = await athena.ops.queue.list({}); return r.blob.length;`, {
      bridge: wideBridge,
    });
    expectFailed(tooBig, "call_output_too_large");

    const { bridge: steadyBridge } = makeBridge(async () => ({ blob: "y".repeat(200 * 1024) }));
    const tooMuch = await execute(
      `let total = 0; for (let i = 0; i < 12; i += 1) { const r = await athena.ops.queue.list({ i }); total += r.blob.length; } return total;`,
      { bridge: steadyBridge, ceilings: { maxRunBridgeBytes: 2 * 1024 * 1024 } },
    );
    expectFailed(tooMuch, "bridge_bytes_exceeded");
    if (tooMuch.status === "failed") expect(tooMuch.diagnostics.hostCalls).toBeLessThanOrEqual(11);
  });

  it("stops at the program result ceiling and the call-args ceiling", async () => {
    const big = await execute(`return "z".repeat(300 * 1024);`);
    expectFailed(big, "result_too_large");
    const args = await execute(`return athena.ops.queue.list({ pad: "a".repeat(70 * 1024) });`);
    expectFailed(args, "call_args_too_large");
  });

  it("rejects non-JSON results and detached bridge calls", async () => {
    const fn = await execute(`return { f: () => 1 };`);
    expectFailed(fn, "result_not_serializable");
    const detached = await execute(`void athena.ops.queue.list({}); return 1;`);
    expectFailed(detached, "detached_call");
    const cyclic = await execute(`const a: Record<string, unknown> = {}; a.self = a; return a;`);
    expectFailed(cyclic, "result_not_serializable");
  });

  it("surfaces guest exceptions and bridge failures as typed failures without host internals", async () => {
    const thrown = await execute(`throw new Error("secret host path /var/lib"); return 1;`);
    expectFailed(thrown, "runtime_error");
    if (thrown.status === "failed") expect(thrown.message).toContain("secret host path");
    const { bridge } = makeBridge(async () => {
      throw new Error("db connection string postgres://user:pw@host");
    });
    const hostFailed = await execute(`return athena.ops.queue.list({});`, { bridge });
    expectFailed(hostFailed, "host_error");
    if (hostFailed.status === "failed") expect(JSON.stringify(hostFailed)).not.toContain("postgres://");
  });
});

describe("cancellation", () => {
  it("terminates in-flight work and ignores late bridge results", async () => {
    let resolveLate: ((value: JsonValue) => void) | undefined;
    let bridgeCompleted = false;
    const { bridge } = makeBridge(
      () =>
        new Promise<JsonValue>((resolve) => {
          resolveLate = (value) => {
            bridgeCompleted = true;
            resolve(value);
          };
        }),
    );
    const controller = new AbortController();
    const pending = execute(`const r = await athena.ops.queue.list({}); return { revived: true, r };`, {
      bridge,
      signal: controller.signal,
      ceilings: { maxElapsedMs: 5_000 },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const outcome = await pending;
    expect(outcome.status).toBe("canceled");
    if (outcome.status !== "canceled") return;
    expect(outcome.reason).toBe("aborted");
    expect(bridgeCompleted).toBe(false);
    resolveLate?.({ late: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridgeCompleted).toBe(true);
    // The attempt stays canceled: the late value never becomes an output.
    expect(outcome).toMatchObject({ status: "canceled" });
  });

  it("reports an already-aborted signal without starting the guest", async () => {
    const { bridge, calls } = makeBridge();
    const controller = new AbortController();
    controller.abort();
    const outcome = await execute(`return athena.ops.queue.list({});`, { bridge, signal: controller.signal });
    expect(outcome.status).toBe("canceled");
    expect(calls).toHaveLength(0);
  });
});

describe("240 KiB encoded call-output ceiling (scenario 9)", () => {
  const ceiling = AGENT_PROGRAM_RUNTIME_CEILINGS.maxCallOutputBytes;

  it("measures UTF-8 bytes, not UTF-16 code units", () => {
    expect(measureUtf8Bytes("abc")).toBe(3);
    expect(measureUtf8Bytes("é")).toBe(2);
    expect(measureUtf8Bytes("€")).toBe(3);
    expect(measureUtf8Bytes("😀")).toBe(4);
    expect(measureUtf8Bytes(JSON.stringify({ a: "😀" }))).toBe(12);
  });

  it("keeps an output that lands exactly on the ceiling and truncates one byte over at the item boundary", () => {
    const metadataHeadroomBytes = 4 * 1024;
    const base = { items: [] as string[], pagination: { hasMore: false } };
    const baseBytes = measureUtf8Bytes(JSON.stringify(base));
    // Fill the collection with fixed-width items until the encoded size is exactly the ceiling.
    const itemBytes = 16; // "xxxxxxxxxxxxxx" + quotes, plus a comma per item after the first
    const budget = ceiling - metadataHeadroomBytes - baseBytes;
    const count = Math.floor((budget + 1) / (itemBytes + 1));
    const items = Array.from({ length: count }, () => "x".repeat(itemBytes - 2));
    const exact = { ...base, items };
    const exactBytes = measureUtf8Bytes(JSON.stringify(exact));
    expect(exactBytes + metadataHeadroomBytes).toBeLessThanOrEqual(ceiling);

    const fit = fitEncodedCallOutput({ output: exact, collectionPath: "items", ceilingBytes: ceiling, metadataHeadroomBytes });
    expect(fit).toMatchObject({ kind: "fits", encodedBytes: exactBytes });

    const overflow = { ...exact, items: [...items, "y".repeat(itemBytes - 2)] };
    const trimmed = fitEncodedCallOutput({ output: overflow, collectionPath: "items", ceilingBytes: ceiling, metadataHeadroomBytes });
    expect(trimmed.kind).toBe("truncated");
    if (trimmed.kind !== "truncated") return;
    expect(trimmed.keptItems).toBeLessThanOrEqual(count);
    expect(trimmed.droppedItems).toBeGreaterThanOrEqual(1);
    expect(trimmed.encodedBytes + metadataHeadroomBytes).toBeLessThanOrEqual(ceiling);
    expect(trimmed.truncation).toEqual({
      reason: "evidence_payload_exceeds_ceiling",
      boundary: "collection_item",
      keptItems: trimmed.keptItems,
      droppedItems: trimmed.droppedItems,
    });
    expect((trimmed.output as { items: string[] }).items).toHaveLength(trimmed.keptItems);
    expect((trimmed.output as { pagination: { hasMore: boolean } }).pagination).toEqual({ hasMore: false });
  });

  it("never splits a multibyte item and counts multibyte text by encoded size", () => {
    const metadataHeadroomBytes = 0;
    const smallCeiling = 40;
    const output = { items: ["😀😀😀", "ééé", "€€€", "plain"] };
    const fit = fitEncodedCallOutput({ output, collectionPath: "items", ceilingBytes: smallCeiling, metadataHeadroomBytes });
    expect(fit.kind).toBe("truncated");
    if (fit.kind !== "truncated") return;
    const kept = (fit.output as { items: string[] }).items;
    expect(kept.every((item) => output.items.includes(item))).toBe(true);
    expect(measureUtf8Bytes(JSON.stringify(fit.output))).toBeLessThanOrEqual(smallCeiling);
    expect(fit.encodedBytes).toBe(measureUtf8Bytes(JSON.stringify(fit.output)));
    for (const item of kept) expect(item.length).toBe(output.items.find((candidate) => candidate === item)?.length);
  });

  it("rejects a snapshot (no collection boundary) that cannot fit instead of mangling it", () => {
    const output = { snapshot: "x".repeat(ceiling + 1) };
    const fit = fitEncodedCallOutput({ output, ceilingBytes: ceiling, metadataHeadroomBytes: 0 });
    expect(fit).toEqual({
      kind: "rejected",
      encodedBytes: measureUtf8Bytes(JSON.stringify(output)),
      truncation: { reason: "evidence_payload_exceeds_ceiling", boundary: "none", keptItems: 0, droppedItems: 0 },
    });
    const emptyCollection = { items: ["x".repeat(ceiling + 1)] };
    const trimmedToNothing = fitEncodedCallOutput({ output: emptyCollection, collectionPath: "items", ceilingBytes: ceiling, metadataHeadroomBytes: 0 });
    expect(trimmedToNothing.kind).toBe("truncated");
    if (trimmedToNothing.kind === "truncated") expect(trimmedToNothing.keptItems).toBe(0);
  });
});

describe("benchmark observations (safety ceilings, not release benchmarks)", () => {
  it("records sandbox startup and execution latency", async () => {
    const fresh = await createQuickJsProgramRuntime();
    const startupMs = fresh.startupMs;
    const { bridge } = makeBridge(async () => ({ items: [1, 2, 3] }));
    const samples: number[] = [];
    const firstProgress: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const begin = performance.now();
      let progressAt: number | undefined;
      const outcome = await fresh.execute({
        source: `const [a, b] = await Promise.all([athena.ops.storeDay.get({ i: ${i} }), athena.ops.queue.list({})]); return a.items.length + b.items.length;`,
        bridge: {
          ...bridge,
          invoke: async (call) => {
            progressAt ??= performance.now() - begin;
            return bridge.invoke(call);
          },
        },
        ceilings: { ...AGENT_PROGRAM_RUNTIME_CEILINGS, maxElapsedMs: 2_000 },
      });
      expect(outcome.status).toBe("completed");
      samples.push(performance.now() - begin);
      if (progressAt !== undefined) firstProgress.push(progressAt);
    }
    const p = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];
    console.log(
      "SANDBOX_BENCHMARK",
      JSON.stringify({
        startupMs: Number(startupMs.toFixed(1)),
        completionP50Ms: Number(p(samples, 0.5).toFixed(2)),
        completionP95Ms: Number(p(samples, 0.95).toFixed(2)),
        firstProgressP50Ms: Number(p(firstProgress, 0.5).toFixed(2)),
        firstProgressP95Ms: Number(p(firstProgress, 0.95).toFixed(2)),
        node: process.version,
      }),
    );
    expect(p(samples, 0.95)).toBeLessThan(1_000);
  });
});
