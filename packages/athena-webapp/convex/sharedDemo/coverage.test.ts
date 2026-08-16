import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySharedDemoExternalGateway,
  deriveSharedDemoGatewayBindings,
  validateSharedDemoCoverage,
} from "./policy";
import { OPERATION_ADMISSION_DEFINITIONS } from "../operationAdmission/definitions";
import { OPERATION_READ_ADMISSION_DEFINITIONS } from "../operationAdmission/readDefinitions";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

function exportedFunctionSource(source: string, functionName: string) {
  const start = source.indexOf(`export const ${functionName} =`);
  if (start < 0) return "";
  const nextExport = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, nextExport < 0 ? undefined : nextExport);
}

describe("shared demo static coverage", () => {
  it("keeps the default-deny public surface and effect sensors wired", () => {
    const policy = readFileSync("convex/sharedDemo/policy.ts", "utf8");
    expect(policy).toContain('defaultDecision: "denied"');
    expect(policy).toContain("SHARED_DEMO_EFFECT_CLASSIFICATIONS");
    expect(policy).toContain("SHARED_DEMO_CAPABILITY_CLASSIFICATIONS");
  });

  it("wires order notification simulation before the real scheduler gateway", () => {
    const source = readFileSync("convex/storeFront/onlineOrder.ts", "utf8");
    expect(source).toContain('decideSharedDemoEffect("order_notification.send"');
    expect(source).toContain('admittedActor?.kind === "shared_demo"');
  });

  it("routes operation order lookup through admitted shared-demo scope", () => {
    const source = readFileSync("convex/storeFront/onlineOrder.ts", "utf8");
    expect(source).toContain("getForOperations");
    expect(source).toContain("getOnlineOrderReadDefinition");
  });

  /**
   * This used to walk every `export const x = mutation(` / `action(` in
   * `convex/` and require `classifySharedDemoPublicFunction` to name a
   * capability for it, via a hand-maintained module→capability map.
   *
   * That map is deleted, and "is this ingress admitted?" is no longer a
   * question a regex can answer: an admitted export still reads
   * `export const x = mutation({ handler: admitPublicMutation(def, fn) })`,
   * so source shape distinguishes nothing. `scripts/convex-operation-admission-check.ts`
   * answers it from the AST across every ingress kind and runs as a gate;
   * duplicating a weaker version of it here would only produce a check that
   * passes for the wrong reason.
   *
   * What is left for this file is the property the map was standing in for,
   * and it is checked against the definitions rather than against text.
   */
  it("keeps demo capability and read-intent grants in both-direction agreement", () => {
    expect(
      validateSharedDemoCoverage(
        OPERATION_ADMISSION_DEFINITIONS,
        OPERATION_READ_ADMISSION_DEFINITIONS,
      ),
    ).toEqual([]);
  });

  it("defaults every discovered provider or network gateway to denied", () => {
    const gateways = new Set<string>();
    for (const file of sourceFiles("convex")) {
      const source = readFileSync(file, "utf8");
      if (/fetch\s*\(|Provider|paystack|send.*Email|send.*Message/i.test(source)) {
        gateways.add(relative("convex", file).replace(/\.ts$/, ""));
      }
    }
    expect(gateways.size).toBeGreaterThan(10);
    for (const gateway of gateways) {
      expect(classifySharedDemoExternalGateway(gateway).decision).toMatch(
        /^(simulated|denied)$/,
      );
    }
  });

  /**
   * Foundation protection: the demo's own organization, store and catalog rows
   * may not be mutated by ANY actor, authenticated or not.
   *
   * Previously asserted by counting `requireNonDemoFoundationMutation(`
   * occurrences in each module's source. That check had quietly stopped
   * meaning anything: the guards are retired and every remaining occurrence in
   * these modules is inside a `// ... retired here ...` comment, so a grep for
   * the identifier passed while nothing enforced it.
   *
   * The successor is the bound `target` guard on the definition, which the rail
   * evaluates against the resolved target row before the handler runs. Counts
   * are exact so that dropping a guard fails rather than degrades.
   */
  it.each([
    ["inventory/organizations", 3],
    ["inventory/stores", 9],
    ["inventory/inviteCode", 1],
    ["inventory/categories", 3],
    ["inventory/productSku", 3],
    ["inventory/products", 9],
    ["inventory/subcategories", 3],
    ["inventory/colors", 3],
    ["inventory/promoCode", 3],
    ["inventory/complimentaryProduct", 5],
  ])(
    "binds demo-foundation protection on %s as a target guard, not a handler call",
    (moduleName, expectedGuards) => {
      const definitions = OPERATION_ADMISSION_DEFINITIONS.filter(
        (definition) => definition.functionName?.startsWith(`${moduleName}:`),
      );
      const guarded = definitions.filter(
        (definition) =>
          definition.target?.protectDemoFoundation !== undefined ||
          definition.target?.protectDemoFoundationExternalRefs !== undefined,
      );
      expect(guarded.length, moduleName).toBe(expectedGuards);

      // A foundation-protected write is never demo-reachable: the guard exists
      // to stop the demo's own rows being edited, so admitting the demo to the
      // same operation would defeat it.
      for (const definition of guarded) {
        expect(definition.actors.sharedDemo, definition.functionName).toBe(
          "deny",
        );
      }

      const source = readFileSync(`convex/${moduleName}.ts`, "utf8");
      expect(source, moduleName).not.toMatch(
        /^\s*(await\s+)?requireNonDemoFoundation\w*\(/m,
      );
    },
  );

  /**
   * Replaces the hand-listed `SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS`, which
   * paired a module with the name of a handler-local guard and was verified by
   * grepping that module's source for the identifier. Those guards are retired,
   * and a grep for an identifier never proved the guard actually ran on the
   * path in question.
   *
   * The successor is the declaration the rail enforces: `effects: { mode:
   * "protected", gateways }`. A demo-reachable operation may only bind a
   * gateway policy classifies as `simulated`; a gateway classified `denied`
   * must have no demo-admitted operation binding it at all.
   */
  it("keeps every demo-reachable external gateway simulated, never live", () => {
    const bindings = deriveSharedDemoGatewayBindings(
      OPERATION_ADMISSION_DEFINITIONS,
    );
    expect(bindings.length).toBeGreaterThan(10);

    const reachable = bindings.filter((binding) => binding.demoReachable);
    expect(reachable.length).toBeGreaterThan(0);
    for (const binding of reachable) {
      expect(
        classifySharedDemoExternalGateway(binding.gateway).decision,
        `${binding.operation} -> ${binding.gateway}`,
      ).toBe("simulated");
    }

    for (const binding of bindings) {
      expect(
        classifySharedDemoExternalGateway(binding.gateway).decision,
        `${binding.operation} -> ${binding.gateway}`,
      ).toMatch(/^(simulated|denied)$/);
    }
  });

  /**
   * The modules that used to open their handlers with
   * `requireAuthenticatedNonDemoEffect` / `denySharedDemoEffectIfApplicable` /
   * `requireSharedDemoCapabilityIfApplicable`. Each of those guards said one
   * thing — "not the demo" — at one point inside one handler. Stated on the
   * definition instead, it holds for the whole operation and is enforced
   * before the handler is entered.
   */
  it.each([
    "inventory/productUtil",
    "inventory/auth",
    "storeFront/auth",
    "cloudflare/stream",
    "operations/staffProfiles",
  ])("keeps every public write in %s outside the demo", (moduleName) => {
    const definitions = OPERATION_ADMISSION_DEFINITIONS.filter(
      (definition) => definition.functionName?.startsWith(`${moduleName}:`),
    );
    for (const definition of definitions) {
      expect(definition.actors.sharedDemo, definition.functionName).toBe(
        "deny",
      );
    }

    const source = readFileSync(`convex/${moduleName}.ts`, "utf8");
    for (const retired of [
      "requireAuthenticatedNonDemoEffect",
      "denySharedDemoEffectIfApplicable",
      "requireSharedDemoCapabilityIfApplicable",
    ]) {
      expect(source, `${moduleName} still calls ${retired}`).not.toMatch(
        new RegExp(`^\\s*(await\\s+|const .*=\\s*(await\\s+)?)?${retired}\\(`, "m"),
      );
    }
  });
});
