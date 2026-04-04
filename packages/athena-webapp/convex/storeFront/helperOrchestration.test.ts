import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const readProjectFile = (...segments: string[]) =>
  readFileSync(join(projectRoot, ...segments), "utf8");

describe("shared helper orchestration", () => {
  it("extracts shared order-update email orchestration so the action wrappers stay thin", () => {
    const orderEmails = readProjectFile(
      "convex",
      "storeFront",
      "onlineOrderUtilFns.ts"
    );
    const helper = readProjectFile(
      "convex",
      "storeFront",
      "helpers",
      "orderUpdateEmails.ts"
    );

    expect(helper).toContain("export async function processOrderUpdateEmail");
    expect(orderEmails).toContain('from "./helpers/orderUpdateEmails"');
    expect(orderEmails).toContain("return await processOrderUpdateEmail");
  });

  it("extracts shared bag loading logic instead of querying the internal bag API from bagItem", () => {
    const bag = readProjectFile("convex", "storeFront", "bag.ts");
    const bagItem = readProjectFile("convex", "storeFront", "bagItem.ts");
    const helper = readProjectFile(
      "convex",
      "storeFront",
      "helpers",
      "bag.ts"
    );

    expect(helper).toContain("export async function loadBagWithItems");
    expect(bag).toContain('from "./helpers/bag"');
    expect(bagItem).toContain('from "./helpers/bag"');
    expect(bagItem).not.toContain(
      "ctx.runQuery(internal.storeFront.bag.getByIdInternal"
    );
  });
});
