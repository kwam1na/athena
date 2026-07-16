import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  POS_APPLICATION_BOUNDARY_INVENTORY,
  POS_APPLICATION_BOUNDARY_SOURCE_MODULES,
  POS_APPLICATION_COMMAND_BOUNDARY_SOURCE_MODULES,
  classifyPosApplicationBoundary,
  findUnclassifiedPosApplicationBoundaries,
  validatePosApplicationBoundaryInventory,
} from "./posApplicationBoundaryInventory";

function discoverConvexCallableExports(moduleName: string) {
  const source = readFileSync(resolve(__dirname, `../../${moduleName}.ts`), "utf8");
  const callables = new Set<string>();
  for (const match of source.matchAll(
    /export const (\w+)\s*=\s*(?:query|mutation|action)\s*\(/g,
  )) {
    callables.add(match[1]);
  }

  const aliases = Array.from(
    source.matchAll(/export const (\w+)\s*=\s*(\w+)\s*;/g),
    (match) => ({ alias: match[1], target: match[2] }),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const { alias, target } of aliases) {
      if (callables.has(target) && !callables.has(alias)) {
        callables.add(alias);
        changed = true;
      }
    }
  }
  return Array.from(callables, (exportName) => `${moduleName}:${exportName}`);
}

function discoverCommandExports(moduleName: string) {
  const source = readFileSync(resolve(__dirname, `../../${moduleName}.ts`), "utf8");
  return Array.from(
    source.matchAll(/export async function (\w+)\s*\(/g),
    (match) => `${moduleName}:${match[1]}`,
  );
}

function discoverAllOwnedBoundaries() {
  return [
    ...POS_APPLICATION_BOUNDARY_SOURCE_MODULES.flatMap(
      discoverConvexCallableExports,
    ),
    ...POS_APPLICATION_COMMAND_BOUNDARY_SOURCE_MODULES.flatMap(
      discoverCommandExports,
    ),
  ].sort();
}

describe("POS application boundary inventory", () => {
  it("is complete, unique, and sourced from every U6-owned callable module", () => {
    const discovered = discoverAllOwnedBoundaries();
    const inventoried = POS_APPLICATION_BOUNDARY_INVENTORY.map(
      ({ functionName }) => functionName,
    ).sort();

    expect(validatePosApplicationBoundaryInventory()).toEqual([]);
    expect(findUnclassifiedPosApplicationBoundaries(discovered)).toEqual([]);
    expect(inventoried).toEqual(discovered);
  });

  it("fails closed for a newly added or unknown callable boundary", () => {
    expect(
      classifyPosApplicationBoundary("pos/public/catalog:newOperation"),
    ).toEqual({ decision: "unclassified" });
    expect(
      findUnclassifiedPosApplicationBoundaries([
        "pos/public/catalog:search",
        "pos/public/catalog:newOperation",
      ]),
    ).toEqual(["pos/public/catalog:newOperation"]);
  });

  it("keeps human, business, and device authority lanes explicit", () => {
    expect(
      classifyPosApplicationBoundary("pos/public/terminals:registerTerminal"),
    ).toEqual({
      classification: "human_administration",
      decision: "classified",
    });
    expect(
      classifyPosApplicationBoundary("pos/public/transactions:completeTransaction"),
    ).toEqual({
      classification: "pos_business_operation",
      decision: "classified",
    });
    expect(
      classifyPosApplicationBoundary("pos/public/terminals:submitTerminalRuntimeStatus"),
    ).toEqual({
      classification: "device_control",
      decision: "classified",
    });
    expect(
      classifyPosApplicationBoundary(
        "pos/public/terminalAppSessions:validateTerminalAppSessionRecovery",
      ),
    ).toEqual({
      classification: "intentionally_public",
      decision: "classified",
    });
  });
});
