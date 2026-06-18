import { describe, expect, it } from "vitest";
import { v } from "convex/values";

import {
  assertConformsToExportedReturns,
  collectReturnValidatorIssues,
} from "./returnValidatorContract";

function serializedValidatorFor(validator: unknown) {
  return (validator as { json: unknown }).json;
}

function definitionFor(validator: unknown) {
  return {
    exportReturns: () => JSON.stringify(serializedValidatorFor(validator)),
  };
}

describe("return validator contract helper", () => {
  it("accepts representative values that conform to nested validators", () => {
    const definition = definitionFor(
      v.object({
        kind: v.literal("ok"),
        data: v.object({
          entries: v.array(
            v.object({
              id: v.id("posTerminal"),
              label: v.string(),
              metadata: v.optional(v.record(v.string(), v.number())),
            }),
          ),
          status: v.union(v.literal("ready"), v.literal("stale")),
        }),
      }),
    );

    expect(() =>
      assertConformsToExportedReturns(definition, {
        kind: "ok",
        data: {
          entries: [
            {
              id: "terminal-1",
              label: "Front register",
              metadata: {
                observedAt: 100,
              },
            },
          ],
          status: "ready",
        },
      }),
    ).not.toThrow();
  });

  it("rejects extra nested object fields that Convex return validators do not allow", () => {
    const definition = definitionFor(
      v.object({
        recoveryPreview: v.object({
          commandStatus: v.object({
            commandId: v.optional(v.string()),
          }),
        }),
      }),
    );

    expect(() =>
      assertConformsToExportedReturns(definition, {
        recoveryPreview: {
          commandStatus: {
            commandId: "command-1",
            appUpdateCommandExecutionId: "execution-1",
          },
        },
      }),
    ).toThrow("$.recoveryPreview.commandStatus.appUpdateCommandExecutionId");
  });

  it("ignores extra undefined object fields that Convex serialization strips", () => {
    const definition = definitionFor(v.object({ status: v.string() }));

    expect(() =>
      assertConformsToExportedReturns(definition, {
        status: "ok",
        stripped: undefined,
      }),
    ).not.toThrow();
  });

  it("rejects missing required nested fields", () => {
    const definition = definitionFor(
      v.object({
        recoveryPreview: v.object({
          appUpdate: v.object({
            evidenceFresh: v.boolean(),
            status: v.string(),
          }),
        }),
      }),
    );

    expect(() =>
      assertConformsToExportedReturns(definition, {
        recoveryPreview: {
          appUpdate: {
            status: "current",
          },
        },
      }),
    ).toThrow("$.recoveryPreview.appUpdate.evidenceFresh");
  });

  it("reports union mismatch without leaking every nested issue as a top-level failure", () => {
    const issues = collectReturnValidatorIssues(
      serializedValidatorFor(
        v.union(
          v.object({ kind: v.literal("ok"), data: v.string() }),
          v.object({ kind: v.literal("not_found") }),
        ),
      ) as never,
      { kind: "ok", data: 42 },
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("matched no union variant");
  });

  it("allows absent optional fields and validates them when present", () => {
    const definition = definitionFor(
      v.object({
        label: v.string(),
        observedAt: v.optional(v.number()),
      }),
    );

    expect(() =>
      assertConformsToExportedReturns(definition, { label: "Ready" }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, {
        label: "Ready",
        observedAt: "soon",
      }),
    ).toThrow("$.observedAt");
  });

  it("ignores undefined record entries that Convex serialization strips", () => {
    const definition = definitionFor(v.record(v.string(), v.string()));

    expect(() =>
      assertConformsToExportedReturns(definition, {
        live: "ok",
        stale: undefined,
      }),
    ).not.toThrow();
  });

  it("ignores undefined record entries before validating stripped keys", () => {
    const definition = definitionFor(v.record(v.literal("live"), v.string()));

    expect(() =>
      assertConformsToExportedReturns(definition, {
        live: "ok",
        stale: undefined,
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, {
        stale: "kept",
      }),
    ).toThrow('${"stale"}');
  });

  it("validates Convex int64 serialized bigint return validators", () => {
    const definition = definitionFor(v.object({ sequence: v.int64() }));

    expect(() =>
      assertConformsToExportedReturns(definition, { sequence: 10n }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, { sequence: 10 }),
    ).toThrow("$.sequence");
    expect(() =>
      assertConformsToExportedReturns(definition, {
        sequence: 9_223_372_036_854_775_808n,
      }),
    ).toThrow("$.sequence");
  });

  it("compares serialized bigint literals against returned bigint values", () => {
    const definition = definitionFor(v.literal(1n));

    expect(() => assertConformsToExportedReturns(definition, 1n)).not.toThrow();
    expect(() => assertConformsToExportedReturns(definition, 2n)).toThrow("$");
  });

  it("validates Convex float64 special values", () => {
    const definition = definitionFor(v.object({ value: v.number() }));

    expect(() =>
      assertConformsToExportedReturns(definition, { value: Number.NaN }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, { value: Infinity }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, { value: -0 }),
    ).not.toThrow();
  });

  it("compares serialized float literals against returned number values", () => {
    expect(() =>
      assertConformsToExportedReturns(definitionFor(v.literal(Number.NaN)), Number.NaN),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definitionFor(v.literal(Infinity)), Infinity),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definitionFor(v.literal(-0)), -0),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definitionFor(v.literal(-0)), 0),
    ).toThrow("$");
  });

  it("rejects non-Convex values even through v.any()", () => {
    const definition = definitionFor(v.object({ payload: v.any() }));

    expect(() =>
      assertConformsToExportedReturns(definition, {
        payload: {
          nested: ["ok", 1, true, null, 2n],
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, {
        payload: Number.NaN,
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, {
        payload: {
          stripped: undefined,
          retained: "ok",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertConformsToExportedReturns(definition, {
        payload: undefined,
      }),
    ).toThrow("$.payload");
    expect(() =>
      assertConformsToExportedReturns(definition, {
        payload: [undefined],
      }),
    ).toThrow("$.payload");
    expect(() =>
      assertConformsToExportedReturns(definition, {
        payload: new Date(),
      }),
    ).toThrow("$.payload");
    expect(() =>
      assertConformsToExportedReturns(definition, {
        payload: () => null,
      }),
    ).toThrow("$.payload");
  });
});
