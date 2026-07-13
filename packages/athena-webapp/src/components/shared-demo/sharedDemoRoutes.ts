import type { SharedDemoRoutes } from "./SharedDemoOwnerHome";

export function getSharedDemoRoutes(orgUrlSlug: string, storeUrlSlug: string): SharedDemoRoutes & { home: string } {
  const storeRoot = `/${encodeURIComponent(orgUrlSlug)}/store/${encodeURIComponent(storeUrlSlug)}`;
  return {
    cash: `${storeRoot}/cash-controls`, home: `${storeRoot}/shared-demo`,
    inventory: `${storeRoot}/operations/stock-adjustments`, operations: `${storeRoot}/operations`,
    orders: `${storeRoot}/orders/ready`, pos: `${storeRoot}/pos`, reports: `${storeRoot}/reports`,
    staff: `${storeRoot}/staff-messages`,
  };
}

export function getSharedDemoArea(pathname: string) {
  if (pathname.includes("/cash-controls")) return "Cash Controls";
  if (pathname.includes("/stock-adjustments") || pathname.includes("/products")) return "Inventory";
  if (pathname.includes("/orders")) return "Orders";
  if (pathname.includes("/pos")) return "POS";
  if (pathname.includes("/reports")) return "Reports";
  if (pathname.includes("/staff-messages")) return "Staff";
  if (pathname.includes("/operations")) return "Operations";
  return "Owner home";
}
