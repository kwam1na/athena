import type { PosRegisterCatalogRowDto } from "@/lib/pos/application/dto";
import type { PosRegisterCatalogRevision } from "@/lib/pos/application/posLocalStoreTypes";

type RegisterCatalogRuntimeScope = {
  storeId: string;
  terminalId: string;
};

type RegisterCatalogRuntimeSelection = RegisterCatalogRuntimeScope & {
  revision: PosRegisterCatalogRevision;
  rows: PosRegisterCatalogRowDto[];
};

const selections = new Map<string, RegisterCatalogRuntimeSelection>();
const actionGuardCounts = new Map<string, number>();
const OWNER_STORAGE_KEY = "athena.pos.registerCatalogOwnerId";
const OWNER_CLAIM_PREFIX = "athena.pos.registerCatalogOwnerClaim:";
const OWNER_CLAIM_LEASE_MS = 24 * 60 * 60 * 1_000;
const OWNER_CLAIM_HEARTBEAT_MS = 5 * 60 * 1_000;
const documentInstanceId = `register-document-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
let fallbackOwnerId: string | null = null;
let claimedOwnerId: string | null = null;
let ownerClaimHeartbeat: ReturnType<typeof setInterval> | null = null;
let ownerClaimCleanupRegistered = false;

type RegisterCatalogOwnerClaim = {
  documentInstanceId: string;
  leaseExpiresAt: number;
};

export function chooseRegisterCatalogRuntimeOwnerId(input: {
  activeClaimDocumentInstanceId?: string;
  createOwnerId: () => string;
  documentInstanceId: string;
  storedOwnerId?: string | null;
}) {
  if (
    input.storedOwnerId &&
    (!input.activeClaimDocumentInstanceId ||
      input.activeClaimDocumentInstanceId === input.documentInstanceId)
  ) {
    return input.storedOwnerId;
  }
  return input.createOwnerId();
}

function ownerClaimKey(ownerId: string) {
  return `${OWNER_CLAIM_PREFIX}${ownerId}`;
}

function readOwnerClaim(ownerId: string): RegisterCatalogOwnerClaim | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ownerClaimKey(ownerId));
    if (!raw) return null;
    const claim = JSON.parse(raw) as Partial<RegisterCatalogOwnerClaim>;
    if (
      typeof claim.documentInstanceId !== "string" ||
      typeof claim.leaseExpiresAt !== "number" ||
      claim.leaseExpiresAt <= Date.now()
    ) {
      localStorage.removeItem(ownerClaimKey(ownerId));
      return null;
    }
    return claim as RegisterCatalogOwnerClaim;
  } catch {
    return null;
  }
}

function writeOwnerClaim(ownerId: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      ownerClaimKey(ownerId),
      JSON.stringify({
        documentInstanceId,
        leaseExpiresAt: Date.now() + OWNER_CLAIM_LEASE_MS,
      } satisfies RegisterCatalogOwnerClaim),
    );
  } catch {
    // Browser storage privacy modes may deny shared claims; the module-local
    // owner remains safe for this document.
  }
}

function maintainOwnerClaim(ownerId: string) {
  writeOwnerClaim(ownerId);
  if (!ownerClaimHeartbeat) {
    ownerClaimHeartbeat = setInterval(
      () => claimedOwnerId && writeOwnerClaim(claimedOwnerId),
      OWNER_CLAIM_HEARTBEAT_MS,
    );
  }
  if (!ownerClaimCleanupRegistered && typeof window !== "undefined") {
    ownerClaimCleanupRegistered = true;
    window.addEventListener("pagehide", (event) => {
      if ((event as PageTransitionEvent).persisted) {
        if (ownerClaimHeartbeat) clearInterval(ownerClaimHeartbeat);
        ownerClaimHeartbeat = null;
        return;
      }
      if (claimedOwnerId && typeof localStorage !== "undefined") {
        try {
          const claim = readOwnerClaim(claimedOwnerId);
          if (claim?.documentInstanceId === documentInstanceId) {
            localStorage.removeItem(ownerClaimKey(claimedOwnerId));
          }
        } catch {
          // Best-effort release; the claim lease bounds crash leftovers.
        }
      }
      if (ownerClaimHeartbeat) clearInterval(ownerClaimHeartbeat);
      ownerClaimHeartbeat = null;
    });
    window.addEventListener("pageshow", () => {
      if (claimedOwnerId) maintainOwnerClaim(claimedOwnerId);
    });
  }
}

function keyForScope(scope: RegisterCatalogRuntimeScope) {
  return `${scope.storeId}\u0000${scope.terminalId}`;
}

export function setRegisterCatalogRuntimeSelection(
  selection: RegisterCatalogRuntimeSelection,
) {
  selections.set(keyForScope(selection), selection);
}

export function clearRegisterCatalogRuntimeSelection(
  scope: RegisterCatalogRuntimeScope,
) {
  selections.delete(keyForScope(scope));
}

export function captureRegisterCatalogRuntimePin(
  scope: RegisterCatalogRuntimeScope,
):
  | Pick<RegisterCatalogRuntimeSelection, "revision" | "rows">
      & { ownerId: string; settleActionGuard: () => void }
  | undefined {
  const scopeKey = keyForScope(scope);
  const selection = selections.get(scopeKey);
  if (!selection) {
    return undefined;
  }
  actionGuardCounts.set(scopeKey, (actionGuardCounts.get(scopeKey) ?? 0) + 1);
  let settled = false;
  return {
    ownerId: getRegisterCatalogRuntimeOwnerId(),
    revision: selection.revision,
    rows: selection.rows,
    settleActionGuard: () => {
      if (settled) return;
      settled = true;
      const remaining = (actionGuardCounts.get(scopeKey) ?? 1) - 1;
      if (remaining > 0) actionGuardCounts.set(scopeKey, remaining);
      else actionGuardCounts.delete(scopeKey);
    },
  };
}

export function hasRegisterCatalogRuntimeActionGuard(
  scope: RegisterCatalogRuntimeScope,
) {
  return (actionGuardCounts.get(keyForScope(scope)) ?? 0) > 0;
}

export function clearRegisterCatalogRuntimeActionGuard(
  scope: RegisterCatalogRuntimeScope,
) {
  actionGuardCounts.delete(keyForScope(scope));
}

export function getRegisterCatalogRuntimeOwnerId() {
  if (claimedOwnerId) return claimedOwnerId;
  if (typeof sessionStorage !== "undefined") {
    const storedOwnerId = sessionStorage.getItem(OWNER_STORAGE_KEY);
    const activeClaim = storedOwnerId ? readOwnerClaim(storedOwnerId) : null;
    claimedOwnerId = chooseRegisterCatalogRuntimeOwnerId({
      activeClaimDocumentInstanceId: activeClaim?.documentInstanceId,
      createOwnerId: () =>
        `register-runtime-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      documentInstanceId,
      storedOwnerId,
    });
    sessionStorage.setItem(OWNER_STORAGE_KEY, claimedOwnerId);
    maintainOwnerClaim(claimedOwnerId);
    return claimedOwnerId;
  }
  fallbackOwnerId ??= `register-runtime-${Math.random().toString(36).slice(2)}`;
  return fallbackOwnerId;
}
