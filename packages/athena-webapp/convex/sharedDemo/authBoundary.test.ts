import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({ getAuthUserId: vi.fn() }));
vi.mock("./actor", () => ({ getSharedDemoActorWithCtx: vi.fn() }));

import { getAuthUserId } from "@convex-dev/auth/server";
import { getAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { getSharedDemoActorWithCtx } from "./actor";

/**
 * The auth boundary after U8.
 *
 * Generic Athena-user authentication is shared-demo-UNAWARE. There is no
 * option a caller can pass to make it consult the demo principal, and it never
 * reaches for one on its own: the only way a demo principal becomes an Athena
 * identity is the admission rail publishing `ctx.operationAdmission.actor`.
 */
describe("shared demo explicit Athena identity adapter", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockResolvedValue("demo-auth" as never);
    vi.mocked(getSharedDemoActorWithCtx).mockResolvedValue({
      athenaUserId: "demo-athena",
      kind: "shared_demo",
      organizationId: "demo-org",
      storeId: "demo-store",
    } as never);
  });

  it("does not resolve a demo admission through the ordinary email path", async () => {
    const ctx = {
      auth: { getUserIdentity: vi.fn() },
      db: { get: vi.fn().mockResolvedValue({ name: "Athena demo owner" }) },
    } as never;
    await expect(getAuthenticatedAthenaUserWithCtx(ctx)).resolves.toBeNull();
  });

  it("maps a demo principal only through an admitted operation actor", async () => {
    const demoUser = { _id: "demo-athena", email: "synthetic@demo.invalid" };
    const db = {
      get: vi.fn(async (table: string) =>
        table === "athenaUser" ? demoUser : null,
      ),
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({
          first: vi.fn(async () => null),
          take: vi.fn(async () => []),
        })),
      })),
    };

    // Admitted: the rail resolved the demo actor, so the identity is present
    // without this module knowing anything about demo policy.
    await expect(
      getAuthenticatedAthenaUserWithCtx({
        auth: { getUserIdentity: vi.fn() },
        db,
        operationAdmission: {
          actor: {
            athenaUserId: demoUser._id,
            kind: "shared_demo",
            organizationId: "demo-org",
            storeId: "demo-store",
          },
        },
      } as never),
    ).resolves.toEqual(demoUser);
    expect(getSharedDemoActorWithCtx).not.toHaveBeenCalled();

    // Unadmitted: the same demo session, reaching the helper directly, is not
    // an Athena identity. The retired `{ sharedDemoCapability }` bridge was
    // the only path that made it one, and it no longer exists.
    await expect(
      getAuthenticatedAthenaUserWithCtx({
        auth: { getUserIdentity: vi.fn() },
        db,
      } as never),
    ).resolves.toBeNull();
    expect(getSharedDemoActorWithCtx).not.toHaveBeenCalled();
  });
});
