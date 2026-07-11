import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  redirect: vi.fn((options: unknown) =>
    Object.assign(new Error("redirect"), { options }),
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  redirect: mocked.redirect,
}));

import { redirectLegacyLanding } from "./-legacy-landing-redirect";

describe("legacy landing route", () => {
  it("redirects to the canonical public home with replacement", () => {
    expect(() => redirectLegacyLanding()).toThrow();
    expect(mocked.redirect).toHaveBeenCalledWith({ to: "/", replace: true });
  });
});
