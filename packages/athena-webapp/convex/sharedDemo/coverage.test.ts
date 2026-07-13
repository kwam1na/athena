import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySharedDemoExternalGateway,
  classifySharedDemoPublicFunction,
  SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS,
} from "./policy";

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
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
    expect(source).toContain("if (demoActor)");
  });

  it("clamps both order lookup paths to the demo store before fulfillment", () => {
    const source = readFileSync("convex/storeFront/onlineOrder.ts", "utf8");
    expect(source.match(/order\.storeId !== demoActor\.storeId/g)).toHaveLength(2);
  });

  it("classifies every exported public mutation and action with unknowns denied", () => {
    const discovered: string[] = [];
    for (const file of sourceFiles("convex")) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /export const\s+(\w+)\s*=\s*(mutation|action)\s*\(/g,
      )) {
        const moduleName = relative("convex", file).replace(/\.ts$/, "");
        const functionName = `${moduleName}:${match[1]}`;
        discovered.push(functionName);
        expect(classifySharedDemoPublicFunction(functionName)).toMatchObject({
          decision: expect.stringMatching(/^(declared|denied)$/),
        });
      }
    }
    expect(discovered.length).toBeGreaterThan(200);
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

  it("binds anonymous demo-foundation administration to an auth-independent guard", () => {
    for (const moduleName of ["inventory/organizations", "inventory/stores"]) {
      const source = readFileSync(`convex/${moduleName}.ts`, "utf8");
      expect(source.match(/requireNonDemoFoundationMutation\(/g)?.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("requires an enforcement binding for each demo-reachable external gateway", () => {
    for (const entry of SHARED_DEMO_GATEWAY_ENFORCEMENT_BINDINGS) {
      const source = readFileSync(`convex/${entry.moduleName}.ts`, "utf8");
      expect(source, entry.moduleName).toContain(entry.binding);
    }
  });

  it("requires runtime foundation bindings across prohibited descendant modules", () => {
    const bindings = [
      ["inventory/inviteCode", "requireNonDemoFoundationMutation"],
      ["inventory/stores", "requireNonDemoFoundationMutation"],
      ["inventory/categories", "requireNonDemoFoundationMutation"],
      ["inventory/productSku", "requireNonDemoFoundation"],
      ["inventory/products", "requireNonDemoFoundationMutation"],
      ["inventory/subcategories", "requireNonDemoFoundationMutation"],
      ["inventory/colors", "requireNonDemoFoundationMutation"],
      ["inventory/promoCode", "requireNonDemoFoundationMutation"],
      ["inventory/complimentaryProduct", "requireNonDemoFoundationMutation"],
      ["inventory/productUtil", "requireAuthenticatedNonDemoEffect"],
      ["inventory/auth", "denySharedDemoEffectIfApplicable"],
      ["storeFront/auth", "denySharedDemoEffectIfApplicable"],
      ["cloudflare/stream", "requireAuthenticatedNonDemoEffect"],
    ] as const;
    for (const [moduleName, binding] of bindings) {
      expect(readFileSync(`convex/${moduleName}.ts`, "utf8"), moduleName).toContain(binding);
    }
  });
});
