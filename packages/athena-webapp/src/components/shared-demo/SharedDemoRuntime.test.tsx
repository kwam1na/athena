import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getSharedDemoRestoreEpochStorageKey } from "./sharedDemoLocalBootstrap";
import { resolveSharedDemoProvidedBootstrapStatus } from "./sharedDemoProviderStatus";

const source = readFileSync(
  join(process.cwd(), "src/components/shared-demo/SharedDemoRuntime.tsx"),
  "utf8",
);

function ProviderStatusProbe({
  restoreEpoch,
  storeId,
}: {
  restoreEpoch: number;
  storeId: string;
}) {
  const hasAppliedRestoreEpoch =
    window.localStorage.getItem(
      getSharedDemoRestoreEpochStorageKey(storeId),
    ) === String(restoreEpoch);
  const status = resolveSharedDemoProvidedBootstrapStatus({
    bootstrapStatus: "ready",
    gatePosUntilReady: true,
    hasAppliedRestoreEpoch,
    hasContext: true,
    restoreStatus: "ready",
  });
  return <span data-testid="provider-status">{status}</span>;
}

describe("SharedDemoRuntime architecture", () => {
  it("leaves pending POS sale and closeout ingestion to the authoritative sync runtime", () => {
    expect(source).not.toContain("api.pos.public.sync.ingestLocalEvents");
    expect(source).not.toContain("store.listEvents()");
    expect(source).not.toContain("store.markEventsSynced");
    expect(source).not.toContain("store.markEventsNeedsReview");
  });

  it("fences restore-sensitive binding and local writes to the active epoch", () => {
    expect(source).toContain("expectedEpoch: restoreEpoch");
    expect(source).toContain("async (assertCurrentEpoch) =>");
    expect(source).toContain("assertCurrentEpoch();");
    expect(source).toContain('seedResult.seedResult !== "already_seeded"');
    expect(
      source.indexOf("observeSharedDemoRuntimeEpoch(storeId, restoreEpoch)"),
    ).toBeLessThan(
      source.indexOf('if (restoreBootstrapStatus !== "ready")'),
    );
  });

  it("synchronously gates children when a ready context advances to a new restore epoch", () => {
    const storeId = "store-1";
    vi.mocked(window.localStorage.getItem).mockImplementation(
      (key) =>
        key === getSharedDemoRestoreEpochStorageKey(storeId) ? "4" : null,
    );
    const { rerender } = render(
      <ProviderStatusProbe restoreEpoch={4} storeId={storeId} />,
    );

    expect(screen.getByTestId("provider-status")).toHaveTextContent("ready");

    rerender(<ProviderStatusProbe restoreEpoch={5} storeId={storeId} />);

    expect(screen.getByTestId("provider-status")).toHaveTextContent(
      "provisioning",
    );
  });
});
