import type { SharedDemoRoutes } from "./SharedDemoOwnerHome";

export function getSharedDemoRoutes(orgUrlSlug: string, storeUrlSlug: string): SharedDemoRoutes & { home: string } {
  const storeRoot = `/${encodeURIComponent(orgUrlSlug)}/store/${encodeURIComponent(storeUrlSlug)}`;
  return {
    cash: `${storeRoot}/cash-controls`, home: `${storeRoot}/shared-demo`,
    inventory: `${storeRoot}/operations/stock-adjustments`, operations: `${storeRoot}/operations`,
    orders: `${storeRoot}/orders/ready`, pos: `${storeRoot}/pos`,
  };
}
