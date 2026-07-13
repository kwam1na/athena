import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PosRegisterCatalogRowDto } from "@/lib/pos/application/dto";
import {
  captureRegisterCatalogRuntimePin,
  chooseRegisterCatalogRuntimeOwnerId,
  clearRegisterCatalogRuntimeSelection,
  getRegisterCatalogRuntimeOwnerId,
  hasRegisterCatalogRuntimeActionGuard,
  setRegisterCatalogRuntimeSelection,
} from "./registerCatalogPinRuntime";

const rows = [{ productSkuId: "sku-1" }] as PosRegisterCatalogRowDto[];

describe("registerCatalogPinRuntime", () => {
  beforeEach(() => {
    clearRegisterCatalogRuntimeSelection({
      storeId: "store-1",
      terminalId: "terminal-1",
    });
  });

  it("captures the exact selected revision and rows for the first durable busy command", () => {
    setRegisterCatalogRuntimeSelection({
      revision: 4,
      rows,
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    const captured = captureRegisterCatalogRuntimePin({
        storeId: "store-1",
        terminalId: "terminal-1",
      });
    expect(captured).toMatchObject({
      ownerId: expect.stringMatching(/^register-runtime-/),
      revision: 4,
      rows,
    });
    expect(captured?.settleActionGuard).toEqual(expect.any(Function));
    captured?.settleActionGuard();
    expect(
      hasRegisterCatalogRuntimeActionGuard({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toBe(false);
  });

  it("does not leak a selection across terminal scopes", () => {
    setRegisterCatalogRuntimeSelection({
      revision: "legacy",
      rows,
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(
      captureRegisterCatalogRuntimePin({
        storeId: "store-1",
        terminalId: "terminal-2",
      }),
    ).toBeUndefined();
  });

  it("keeps overlapping command guards active until every command settles", () => {
    const scope = { storeId: "store-1", terminalId: "terminal-1" };
    setRegisterCatalogRuntimeSelection({
      revision: 4,
      rows,
      ...scope,
    });

    const first = captureRegisterCatalogRuntimePin(scope);
    const second = captureRegisterCatalogRuntimePin(scope);
    expect(hasRegisterCatalogRuntimeActionGuard(scope)).toBe(true);

    first?.settleActionGuard();
    first?.settleActionGuard();
    expect(hasRegisterCatalogRuntimeActionGuard(scope)).toBe(true);

    second?.settleActionGuard();
    expect(hasRegisterCatalogRuntimeActionGuard(scope)).toBe(false);
  });

  it("rotates a copied owner for a second live document but restores it after release", () => {
    const createOwnerId = vi.fn(() => "rotated-owner");

    expect(
      chooseRegisterCatalogRuntimeOwnerId({
        createOwnerId,
        documentInstanceId: "document-2",
        storedOwnerId: "copied-owner",
        activeClaimDocumentInstanceId: "document-1",
      }),
    ).toBe("rotated-owner");
    expect(
      chooseRegisterCatalogRuntimeOwnerId({
        createOwnerId,
        documentInstanceId: "document-reload",
        storedOwnerId: "copied-owner",
      }),
    ).toBe("copied-owner");
    expect(createOwnerId).toHaveBeenCalledTimes(1);
  });

  it("preserves and renews the owner claim across BFCache pagehide/pageshow", () => {
    const ownerId = getRegisterCatalogRuntimeOwnerId();
    const claimKey = `athena.pos.registerCatalogOwnerClaim:${ownerId}`;
    expect(localStorage.getItem(claimKey)).not.toBeNull();

    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });
    window.dispatchEvent(pagehide);
    expect(localStorage.getItem(claimKey)).not.toBeNull();

    window.dispatchEvent(new Event("pageshow"));
    expect(localStorage.getItem(claimKey)).not.toBeNull();
  });
});
