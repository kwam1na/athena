import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  getAuthenticatedAthenaUserWithCtx: vi.fn(),
  getServicePrincipalActorWithCtx: vi.fn(),
  getSharedDemoActorWithCtx: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mocks.getAuthUserId,
}));
vi.mock("./athenaUserAuth", () => ({
  getAuthenticatedAthenaUserWithCtx: mocks.getAuthenticatedAthenaUserWithCtx,
}));
vi.mock("../servicePrincipals/actor", () => ({
  getServicePrincipalActorWithCtx: mocks.getServicePrincipalActorWithCtx,
}));
vi.mock("../sharedDemo/actor", () => ({
  getSharedDemoActorWithCtx: mocks.getSharedDemoActorWithCtx,
}));

import {
  getAuthenticatedActorWithCtx,
  requireAuthenticatedActorWithCtx,
} from "./authenticatedActor";

describe("authenticated actor resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServicePrincipalActorWithCtx.mockResolvedValue(null);
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
    mocks.getAuthUserId.mockResolvedValue(null);
    mocks.getAuthenticatedAthenaUserWithCtx.mockResolvedValue(null);
  });

  it("returns a valid service actor without entering demo or human lanes", async () => {
    const serviceActor = {
      kind: "service_principal",
      authUserId: "service-user",
      authSessionId: "service-session",
    };
    mocks.getServicePrincipalActorWithCtx.mockResolvedValue(serviceActor);

    await expect(getAuthenticatedActorWithCtx({} as never)).resolves.toBe(
      serviceActor,
    );
    expect(mocks.getSharedDemoActorWithCtx).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
  });

  it("does not fall through when a bound service identity is invalid", async () => {
    mocks.getServicePrincipalActorWithCtx.mockRejectedValue(
      new Error("The service session is no longer valid."),
    );

    await expect(getAuthenticatedActorWithCtx({} as never)).rejects.toThrow(
      "service session is no longer valid",
    );
    expect(mocks.getSharedDemoActorWithCtx).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
  });

  it("resolves shared-demo before the human lane", async () => {
    const sharedDemoActor = {
      kind: "shared_demo",
      authUserId: "demo-user",
      athenaUserId: "demo-athena-user",
    };
    mocks.getSharedDemoActorWithCtx.mockResolvedValue(sharedDemoActor);

    await expect(getAuthenticatedActorWithCtx({} as never)).resolves.toBe(
      sharedDemoActor,
    );
    expect(mocks.getAuthenticatedAthenaUserWithCtx).not.toHaveBeenCalled();
  });

  it("resolves an ordinary authenticated Athena user as human", async () => {
    mocks.getAuthUserId.mockResolvedValue("human-auth-user");
    mocks.getAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user",
    });

    await expect(getAuthenticatedActorWithCtx({} as never)).resolves.toEqual({
      kind: "human",
      authUserId: "human-auth-user",
      athenaUserId: "athena-user",
    });
  });

  it("requires one authenticated actor lane", async () => {
    await expect(requireAuthenticatedActorWithCtx({} as never)).rejects.toThrow(
      "Sign in again to continue.",
    );
  });
});
