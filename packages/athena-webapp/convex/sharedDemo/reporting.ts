import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { getSharedDemoActorWithCtx } from "./actor";

export function summarizeSharedDemoReport(input: {
  orderItems: Array<Array<Pick<Doc<"onlineOrderItem">, "quantity">>>;
  orders: Array<Pick<Doc<"onlineOrder">, "amount">>;
  transactionItems: Array<
    Array<Pick<Doc<"posTransactionItem">, "quantity">>
  >;
  transactions: Array<Pick<Doc<"posTransaction">, "total">>;
}) {
  const posRevenue = input.transactions.reduce(
    (sum, transaction) => sum + transaction.total,
    0,
  );
  const storefrontRevenue = input.orders.reduce(
    (sum, order) => sum + order.amount,
    0,
  );
  const unitsSold = [...input.transactionItems, ...input.orderItems]
    .flat()
    .reduce((sum, item) => sum + item.quantity, 0);
  return { posRevenue, storefrontRevenue, unitsSold };
}

export async function getSharedDemoReportsOverviewWithCtx(
  ctx: QueryCtx,
  args: { currency?: string; storeId: Id<"store"> },
) {
  const actor = await getSharedDemoActorWithCtx(ctx);
  if (!actor) return null;
  if (actor.storeId !== args.storeId) {
    throw new Error("This action is unavailable in the demo.");
  }

  const [transactions, deliveredOrders, pickedUpOrders] = await Promise.all([
    ctx.db
      .query("posTransaction")
      .withIndex("by_storeId_status_completedAt", (q) =>
        q.eq("storeId", args.storeId).eq("status", "completed"),
      )
      .take(200),
    ctx.db
      .query("onlineOrder")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "delivered"),
      )
      .take(100),
    ctx.db
      .query("onlineOrder")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "picked-up"),
      )
      .take(100),
  ]);
  const orders = [...deliveredOrders, ...pickedUpOrders];
  const [transactionItems, orderItems] = await Promise.all([
    Promise.all(
      transactions.map((transaction) =>
        ctx.db
          .query("posTransactionItem")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id),
          )
          .take(100),
      ),
    ),
    Promise.all(
      orders.map((order) =>
        ctx.db
          .query("onlineOrderItem")
          .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
          .take(100),
      ),
    ),
  ]);
  const { posRevenue, storefrontRevenue, unitsSold } =
    summarizeSharedDemoReport({
      orderItems,
      orders,
      transactionItems,
      transactions,
    });

  return {
    data: {
      attention: [],
      completeness: "provisional" as const,
      currencyCode: args.currency,
      currencyMinorUnitScale: 2,
      limitingReason: "live_shared_demo_snapshot",
      metrics: {
        comparison_known_gross_profit: null,
        comparison_net_sales: null,
        comparison_units_sold: null,
        cost_coverage_basis_points: null,
        inventory_value: null,
        known_gross_profit: null,
        net_sales: posRevenue + storefrontRevenue,
        pos_merchandise_revenue: posRevenue,
        refunds: 0,
        service_revenue: 0,
        storefront_merchandise_revenue: storefrontRevenue,
        units_sold: unitsSold,
      },
    },
    generationId: null,
    sourceWatermark: Date.now(),
    status: "partial" as const,
  };
}
