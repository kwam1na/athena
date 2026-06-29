import { describe, expect, it, vi } from "vitest";

import { usePOSRegisterCatalog } from "./usePOSProducts";
import type { Id } from "~/convex/_generated/dataModel";

const catalogGatewayMocks = vi.hoisted(() => ({
  useConvexRegisterCatalog: vi.fn(),
}));

vi.mock("@/lib/pos/infrastructure/convex/catalogGateway", () => ({
  useConvexBarcodeLookup: vi.fn(),
  useConvexDirectTransactionMutation: vi.fn(),
  useConvexPendingCheckoutItemForSale: vi.fn(),
  useConvexPendingCheckoutItemsForReview: vi.fn(),
  useConvexProductIdLookup: vi.fn(),
  useConvexProductSearch: vi.fn(),
  useConvexQuickAddCatalogItem: vi.fn(),
  useConvexRegisterCatalog: catalogGatewayMocks.useConvexRegisterCatalog,
  useConvexResolvePendingCheckoutItemReview: vi.fn(),
}));

describe("usePOSProducts", () => {
  it("refreshes register catalog metadata for POS-facing catalog consumers", () => {
    usePOSRegisterCatalog("store-1" as Id<"store">);

    expect(catalogGatewayMocks.useConvexRegisterCatalog).toHaveBeenCalledWith({
      refreshMetadataSnapshot: true,
      storeId: "store-1",
    });
  });
});
