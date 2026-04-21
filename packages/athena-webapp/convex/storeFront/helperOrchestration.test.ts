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

  it("extracts shared checkout and order orchestration helpers instead of same-runtime internal order calls", () => {
    const checkoutSession = readProjectFile(
      "convex",
      "storeFront",
      "checkoutSession.ts"
    );
    const onlineOrder = readProjectFile(
      "convex",
      "storeFront",
      "onlineOrder.ts"
    );
    const helper = readProjectFile(
      "convex",
      "storeFront",
      "helpers",
      "onlineOrder.ts"
    );

    expect(helper).toContain("export async function createOrderFromCheckoutSession");
    expect(helper).toContain("export async function clearBagItems");
    expect(helper).toContain("export async function findOrderByExternalReference");
    expect(helper).toContain("export async function returnOrderItemsToStock");

    expect(checkoutSession).toContain('from "./helpers/onlineOrder"');
    expect(onlineOrder).toContain('from "./helpers/onlineOrder"');

    expect(checkoutSession).not.toContain(
      "ctx.runQuery(internal.storeFront.onlineOrder.getInternal"
    );
    expect(checkoutSession).not.toContain(
      "ctx.runMutation(internal.storeFront.bag.clearBag"
    );
    expect(checkoutSession).not.toContain(
      "ctx.runMutation(internal.storeFront.onlineOrder.createInternal"
    );

    expect(onlineOrder).not.toContain(
      "ctx.runMutation(internal.storeFront.bag.clearBag"
    );
    expect(onlineOrder).not.toContain(
      "ctx.runMutation(\n            internal.storeFront.onlineOrder.returnAllItemsToStockInternal"
    );
  });

  it("extracts online-order operations rail orchestration behind a shared helper", () => {
    const helper = readProjectFile(
      "convex",
      "storeFront",
      "helpers",
      "orderOperations.ts"
    );
    const orderHelper = readProjectFile(
      "convex",
      "storeFront",
      "helpers",
      "onlineOrder.ts"
    );
    const onlineOrder = readProjectFile(
      "convex",
      "storeFront",
      "onlineOrder.ts"
    );
    const onlineOrderItem = readProjectFile(
      "convex",
      "storeFront",
      "onlineOrderItem.ts"
    );
    const payment = readProjectFile("convex", "storeFront", "payment.ts");

    expect(helper).toContain("export async function recordOnlineOrderCreatedEvent");
    expect(helper).toContain("export async function recordOnlineOrderPaymentVerified");
    expect(helper).toContain("export async function recordOnlineOrderRestockMovement");
    expect(orderHelper).toContain('from "./orderOperations"');
    expect(onlineOrder).toContain('from "./helpers/orderOperations"');
    expect(onlineOrderItem).toContain('from "./helpers/orderOperations"');
    expect(payment).toContain(
      "internal.operations.paymentAllocations.recordPaymentAllocation"
    );
  });
});
